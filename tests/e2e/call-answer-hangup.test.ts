import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, test, vi } from "vitest";

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
const TONE_SECONDS = 65;
const TONE_AMPLITUDE = Math.round(0.25 * (2 ** 15 - 1));
const CALLER_TONE_HZ = 440;
const CALLEE_TONE_HZ = 880;
const FREQUENCY_TOLERANCE = 0.2;
const MIN_NON_SILENT_SECONDS = 0.5;
const SILENCE_THRESHOLD = 1000;
const AUDIO_POLL_INTERVAL_MS = 250;
const EXERCISE_DEADLINE_MS = 60_000;

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

const describeToneObservation = (expectedHz: number, analysis: ToneAnalysis) =>
  `expected remote tone ${expectedHz} Hz, observed median ${analysis.medianFrequencyHz.toFixed(1)} Hz over ${Math.round(analysis.nonSilentSeconds * 1000)} ms of non-silent audio`;

const forceDisposeSession = (session: CallSession | OutboundCallSession) => {
  try {
    void session.hangup();
  } catch {}
  (session as unknown as { media: { dispose(): boolean } }).media.dispose();
};

describe("E2E call flow", () => {
  test("callee preserves a call and bidirectional audio across signaling recovery", async () => {
    const callerOptions = sipConfigFromPrefix("SIP_A");
    const calleeOptions = sipConfigFromPrefix("SIP_B");
    const caller = new Softphone(callerOptions);
    const callee = new Softphone(calleeOptions);
    const inboundCallPromise = (
      once(callee, "invite") as Promise<[InboundInvite]>
    ).then(async ([invite]) => ({
      invite,
      session: await callee.answer(invite),
    }));

    let outboundSession: OutboundCallSession | undefined;
    let inboundSession: CallSession | undefined;
    let callerStreamer: Streamer | undefined;
    let calleeStreamer: Streamer | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let outboundWasDisposed = false;
    let inboundWasDisposed = false;

    try {
      await Promise.all([caller.register(), callee.register()]);

      outboundSession = await caller.call(calleeOptions.username);
      const answeredPromise = once(outboundSession, "answered");
      const { invite, session } = await inboundCallPromise;
      inboundSession = session;

      await answeredPromise;
      expect(invite).toBeDefined();
      expect(outboundSession.callId).not.toBe("");
      expect(inboundSession.callId).not.toBe("");

      const outboundDisposed = once(outboundSession, "disposed").then(() => {
        outboundWasDisposed = true;
      });
      const inboundDisposed = once(inboundSession, "disposed").then(() => {
        inboundWasDisposed = true;
      });

      const exerciseStart = Date.now();
      let callerObservation = "no audio analyzed yet";
      let calleeObservation = "no audio analyzed yet";
      const exerciseDeadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          reject(
            new Error(
              `signaling recovery audio exercise exceeded its ${EXERCISE_DEADLINE_MS} ms deadline`,
            ),
          );
        }, EXERCISE_DEADLINE_MS);
      });
      void exerciseDeadline.catch(() => {});

      const callerPreRecoveryChunks: Buffer[] = [];
      const calleePreRecoveryChunks: Buffer[] = [];
      const callerPostRecoveryChunks: Buffer[] = [];
      const calleePostRecoveryChunks: Buffer[] = [];
      let collectingPostRecoveryAudio = false;
      outboundSession.on("audio", (audio) => {
        if (collectingPostRecoveryAudio) {
          callerPostRecoveryChunks.push(audio);
        } else {
          callerPreRecoveryChunks.push(audio);
        }
      });
      inboundSession.on("audio", (audio) => {
        if (collectingPostRecoveryAudio) {
          calleePostRecoveryChunks.push(audio);
        } else {
          calleePreRecoveryChunks.push(audio);
        }
      });

      callerStreamer = outboundSession.streamAudio(
        generateTone(CALLER_TONE_HZ),
      );
      calleeStreamer = inboundSession.streamAudio(generateTone(CALLEE_TONE_HZ));
      let callerStreamerFinished = false;
      let calleeStreamerFinished = false;
      once(callerStreamer, "finished").then(() => {
        callerStreamerFinished = true;
      });
      once(calleeStreamer, "finished").then(() => {
        calleeStreamerFinished = true;
      });

      const previousSignaling = callee.signaling;
      let reconciliationInviteCount = 0;
      let reconciliationAckCount = 0;
      callee.on("outboundMessage", (message) => {
        if (message.startsWith("INVITE ")) {
          reconciliationInviteCount += 1;
        }
        if (message.startsWith("ACK ")) {
          reconciliationAckCount += 1;
          collectingPostRecoveryAudio = true;
        }
      });
      const signalingErrors: Error[] = [];
      callee.on("signalingError", (error) => signalingErrors.push(error));

      const describeFailure = (phase: string) =>
        [
          `signaling recovery audio exercise failed in phase "${phase}"`,
          `elapsed ${Date.now() - exerciseStart} ms of the ${EXERCISE_DEADLINE_MS} ms exercise deadline`,
          `signaling errors observed: ${
            signalingErrors.length === 0
              ? "none"
              : signalingErrors
                  .map((error) => {
                    const code = (error as NodeJS.ErrnoException).code;
                    const message = error.message.slice(0, 200);
                    return code === undefined
                      ? message
                      : `${message} (code ${code})`;
                  })
                  .join("; ")
          }`,
          `reconciliation messages observed: ${reconciliationInviteCount} re-INVITE, ${reconciliationAckCount} ACK`,
          `caller streamer finished: ${callerStreamerFinished}`,
          `callee streamer finished: ${calleeStreamerFinished}`,
          `caller-side audio: ${callerObservation}`,
          `callee-side audio: ${calleeObservation}`,
        ].join("; ");

      const boundedPhase = async (
        phase: string,
        operation: () => Promise<void>,
      ) => {
        const operationPromise = operation();
        void operationPromise.catch(() => {});
        try {
          await Promise.race([operationPromise, exerciseDeadline]);
        } catch (error) {
          throw new Error(describeFailure(phase), { cause: error });
        }
      };

      const recognizeBothTones = async (
        phase: string,
        callerChunks: Buffer[],
        calleeChunks: Buffer[],
      ) => {
        for (;;) {
          const callerAnalysis = analyzeTone(callerChunks);
          const calleeAnalysis = analyzeTone(calleeChunks);
          callerObservation = `${describeToneObservation(CALLEE_TONE_HZ, callerAnalysis)} (${phase})`;
          calleeObservation = `${describeToneObservation(CALLER_TONE_HZ, calleeAnalysis)} (${phase})`;
          if (
            recognizesTone(callerAnalysis, CALLEE_TONE_HZ) &&
            recognizesTone(calleeAnalysis, CALLER_TONE_HZ)
          ) {
            return;
          }
          if (Date.now() - exerciseStart >= EXERCISE_DEADLINE_MS) {
            throw new Error(
              "recognizable bidirectional audio was not observed before the exercise deadline",
            );
          }
          await sleep(AUDIO_POLL_INTERVAL_MS);
        }
      };

      const preFailurePhase = "pre-failure bidirectional audio recognition";
      await boundedPhase(preFailurePhase, () =>
        recognizeBothTones(
          preFailurePhase,
          callerPreRecoveryChunks,
          calleePreRecoveryChunks,
        ),
      );

      const reset = Object.assign(new Error("read ECONNRESET"), {
        code: "ECONNRESET",
      });
      (
        previousSignaling as unknown as {
          socket: { destroy(error: Error): void };
        }
      ).socket.destroy(reset);

      await boundedPhase("awaiting replacement signaling", () =>
        vi.waitFor(() => expect(callee.signaling).not.toBe(previousSignaling), {
          timeout: 30_000,
        }),
      );
      await boundedPhase("awaiting signalingError observation", () =>
        vi.waitFor(
          () =>
            expect(signalingErrors.some((error) => error === reset)).toBe(true),
          { timeout: 30_000 },
        ),
      );
      expect(outboundWasDisposed).toBe(false);
      expect(inboundWasDisposed).toBe(false);
      await boundedPhase("awaiting dialog reconciliation re-INVITE", () =>
        vi.waitFor(() => expect(reconciliationInviteCount).toBeGreaterThan(0), {
          timeout: 30_000,
        }),
      );
      await boundedPhase("awaiting dialog reconciliation ACK", () =>
        vi.waitFor(() => expect(reconciliationAckCount).toBeGreaterThan(0), {
          timeout: 30_000,
        }),
      );

      const postRecoveryPhase = "post-recovery bidirectional audio recognition";
      await boundedPhase(postRecoveryPhase, () =>
        recognizeBothTones(
          postRecoveryPhase,
          callerPostRecoveryChunks,
          calleePostRecoveryChunks,
        ),
      );

      callerStreamer.stop();
      calleeStreamer.stop();

      await inboundSession.hangup();
      await Promise.all([outboundDisposed, inboundDisposed]);
    } finally {
      clearTimeout(deadlineTimer);
      callerStreamer?.stop();
      calleeStreamer?.stop();
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
