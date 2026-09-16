import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, test } from "vitest";

import Softphone, {
  type CallSession,
  type InboundInvite,
  type OutboundCallSession,
  type SoftphoneOptions,
  type Streamer,
} from "../../src/index.js";

const requiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env var: ${key}`);
  }
  return value;
};

const sipConfigFromPrefix = (prefix: "SIP_A" | "SIP_B"): SoftphoneOptions => ({
  outboundProxy: requiredEnv(`${prefix}_OUTBOUND_PROXY`),
  username: requiredEnv(`${prefix}_USERNAME`),
  password: requiredEnv(`${prefix}_PASSWORD`),
  authorizationId: requiredEnv(`${prefix}_AUTHORIZATION_ID`),
  domain: requiredEnv(`${prefix}_DOMAIN`),
});

const SAMPLE_RATE = 16_000;
const TONE_SECONDS = 1;
const TONE_AMPLITUDE = Math.round(0.25 * (2 ** 15 - 1));
const FIRST_CALL_TONE_HZ = 440;
const SECOND_CALL_TONE_HZ = 880;
const FREQUENCY_TOLERANCE = 0.2;
const MIN_NON_SILENT_SECONDS = 0.5;
const SILENCE_THRESHOLD = 1000;
const AUDIO_POLL_INTERVAL_MS = 250;
const SCENARIO_DEADLINE_MS = 90_000;

const generateTone = (frequencyHz: number) => {
  const sampleCount = SAMPLE_RATE * TONE_SECONDS;
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index++) {
    pcm.writeInt16LE(
      Math.round(
        TONE_AMPLITUDE *
          Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE),
      ),
      index * 2,
    );
  }
  return pcm;
};

type ToneAnalysis = {
  medianFrequencyHz: number;
  nonSilentSeconds: number;
};

const analyzeTone = (chunks: Buffer[]): ToneAnalysis => {
  const loudFrames: { samples: number; crossings: number }[] = [];
  for (const chunk of chunks) {
    const sampleCount = Math.floor(chunk.length / 2);
    let peak = 0;
    let crossings = 0;
    let previous = 0;
    for (let index = 0; index < sampleCount; index++) {
      const value = chunk.readInt16LE(index * 2);
      peak = Math.max(peak, Math.abs(value));
      if (value > 0 && previous <= 0) {
        crossings += 1;
      }
      previous = value;
    }
    if (sampleCount > 0 && peak > SILENCE_THRESHOLD) {
      loudFrames.push({ samples: sampleCount, crossings });
    }
  }
  const nonSilentSeconds = loudFrames.reduce(
    (total, frame) => total + frame.samples / SAMPLE_RATE,
    0,
  );
  const estimates = loudFrames
    .map((frame) => frame.crossings / (frame.samples / SAMPLE_RATE))
    .sort((left, right) => left - right);
  const middle = Math.floor(estimates.length / 2);
  const medianFrequencyHz =
    estimates.length === 0
      ? 0
      : estimates.length % 2 === 1
        ? estimates[middle]
        : (estimates[middle - 1] + estimates[middle]) / 2;
  return { medianFrequencyHz, nonSilentSeconds };
};

const recognizesTone = (analysis: ToneAnalysis, expectedHz: number) =>
  analysis.nonSilentSeconds >= MIN_NON_SILENT_SECONDS &&
  Math.abs(analysis.medianFrequencyHz - expectedHz) <=
    expectedHz * FREQUENCY_TOLERANCE;

const forceDisposeSession = (session: CallSession | OutboundCallSession) => {
  try {
    void session.hangup();
  } catch {}
  (session as unknown as { media: { dispose(): boolean } }).media.dispose();
};

describe("E2E sequential calls", () => {
  test("one registration completes two sequential calls with fresh Call-IDs and recognizable per-call media", async () => {
    const callerOptions = sipConfigFromPrefix("SIP_A");
    const calleeOptions = sipConfigFromPrefix("SIP_B");
    const caller = new Softphone(callerOptions);
    const callee = new Softphone(calleeOptions);

    let outboundSession: OutboundCallSession | undefined;
    let inboundSession: CallSession | undefined;
    let activeStreamer: Streamer | undefined;
    let outboundWasDisposed = false;
    let inboundWasDisposed = false;

    const scenarioStart = Date.now();
    let callIndex = 0;
    let callIdNonEmpty = false;
    let callIdLegsEqual = false;
    let callIdsDistinctAcrossCalls: string = "not evaluated yet";
    let expectedToneHz: number | undefined;
    let observedToneHz: number | undefined;
    let recognizableSeconds: number | undefined;

    const describeFailure = (phase: string) =>
      [
        `sequential calls scenario failed in phase "${phase}"`,
        `call index: ${callIndex}`,
        `elapsed ${Date.now() - scenarioStart} ms of the ${SCENARIO_DEADLINE_MS} ms scenario deadline`,
        `Call-ID relationships (identifiers withheld): non-empty: ${callIdNonEmpty}, legs equal: ${callIdLegsEqual}, distinct across calls: ${callIdsDistinctAcrossCalls}`,
        `expected tone: ${expectedToneHz ?? "unknown"} Hz, observed median: ${observedToneHz?.toFixed(1) ?? "unknown"} Hz over ${
          recognizableSeconds === undefined
            ? "unknown"
            : Math.round(recognizableSeconds * 1000)
        } ms of non-silent audio (tolerance ±${Math.round(FREQUENCY_TOLERANCE * 100)}%)`,
        `disposal state: outbound leg disposed: ${outboundWasDisposed}, inbound leg disposed: ${inboundWasDisposed}`,
      ].join("; ");

    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        reject(new Error(describeFailure("scenario deadline exceeded")));
      }, SCENARIO_DEADLINE_MS);
    });
    void deadline.catch(() => {});

    const boundedPhase = async <T>(
      phase: string,
      operation: () => Promise<T>,
    ): Promise<T> => {
      const operationPromise = operation();
      void operationPromise.catch(() => {});
      try {
        return await Promise.race([operationPromise, deadline]);
      } catch (error) {
        throw new Error(describeFailure(phase), { cause: error });
      }
    };

    try {
      await boundedPhase("registering both softphones", async () => {
        await Promise.all([caller.register(), callee.register()]);
      });

      let previousCallCallId: string | undefined;

      for (const [index, toneHz] of [
        FIRST_CALL_TONE_HZ,
        SECOND_CALL_TONE_HZ,
      ].entries()) {
        callIndex = index + 1;
        expectedToneHz = toneHz;
        observedToneHz = undefined;
        recognizableSeconds = undefined;
        callIdNonEmpty = false;
        callIdLegsEqual = false;
        callIdsDistinctAcrossCalls =
          previousCallCallId === undefined
            ? "not applicable before the first call"
            : "not evaluated yet";
        outboundWasDisposed = false;
        inboundWasDisposed = false;

        // A fresh B invite listener is armed before each call so the inbound
        // event cannot be missed or reused from the prior iteration.
        const inboundCallPromise = (
          once(callee, "invite") as Promise<[InboundInvite]>
        ).then(async ([invite]) => ({
          invite,
          session: await callee.answer(invite),
        }));
        void inboundCallPromise.catch(() => {});

        const outbound = await boundedPhase(
          `call ${callIndex}: placing the outbound call`,
          async () => {
            const session = await caller.call(calleeOptions.username);
            outboundSession = session;
            return session;
          },
        );

        const answeredPromise = once(outbound, "answered");
        const inbound = await boundedPhase(
          `call ${callIndex}: awaiting B answer and A answered`,
          async () => {
            const answered = await inboundCallPromise;
            inboundSession = answered.session;
            await answeredPromise;
            return answered.session;
          },
        );

        await boundedPhase(
          `call ${callIndex}: asserting Call-ID relationships`,
          async () => {
            const outboundCallId = outbound.callId;
            const inboundCallId = inbound.callId;
            callIdNonEmpty = outboundCallId !== "" && inboundCallId !== "";
            expect(
              callIdNonEmpty,
              "outbound and inbound Call-IDs must be non-empty (values withheld)",
            ).toBe(true);
            callIdLegsEqual = outboundCallId === inboundCallId;
            expect(
              callIdLegsEqual,
              "outbound and inbound Call-IDs must be equal within one call (values withheld)",
            ).toBe(true);
            if (previousCallCallId !== undefined) {
              const distinctAcrossCalls = outboundCallId !== previousCallCallId;
              callIdsDistinctAcrossCalls = String(distinctAcrossCalls);
              expect(
                distinctAcrossCalls,
                "the second call's Call-ID must differ from the first call's Call-ID (values withheld)",
              ).toBe(true);
            }
          },
        );

        // A's public audio listener is attached before B's Streamer starts.
        const receivedAudio: Buffer[] = [];
        outbound.on("audio", (audio) => receivedAudio.push(audio));

        await boundedPhase(
          `call ${callIndex}: streaming and recognizing the callee tone`,
          async () => {
            const streamer = inbound.streamAudio(generateTone(toneHz));
            activeStreamer = streamer;
            for (;;) {
              const analysis = analyzeTone(receivedAudio);
              observedToneHz = analysis.medianFrequencyHz;
              recognizableSeconds = analysis.nonSilentSeconds;
              if (recognizesTone(analysis, toneHz)) {
                return;
              }
              if (Date.now() - scenarioStart >= SCENARIO_DEADLINE_MS) {
                throw new Error(
                  "recognizable non-silent audio was not observed before the scenario deadline",
                );
              }
              await sleep(AUDIO_POLL_INTERVAL_MS);
            }
          },
        );
        activeStreamer?.stop();
        activeStreamer = undefined;

        await boundedPhase(
          `call ${callIndex}: hanging up and awaiting disposal of both legs`,
          async () => {
            const outboundDisposed = once(outbound, "disposed").then(() => {
              outboundWasDisposed = true;
            });
            const inboundDisposed = once(inbound, "disposed").then(() => {
              inboundWasDisposed = true;
            });
            await outbound.hangup();
            await Promise.all([outboundDisposed, inboundDisposed]);
          },
        );

        // Both legs are disposed before the next invite listener is armed or
        // the next call begins.
        previousCallCallId = outbound.callId;
      }
    } finally {
      clearTimeout(deadlineTimer);
      activeStreamer?.stop();
      if (outboundSession && !outboundWasDisposed) {
        forceDisposeSession(outboundSession);
      }
      if (inboundSession && !inboundWasDisposed) {
        forceDisposeSession(inboundSession);
      }
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
