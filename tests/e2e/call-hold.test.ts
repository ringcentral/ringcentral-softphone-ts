import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, test } from "vitest";

import Softphone, {
  type CallSession,
  type InboundInvite,
  type OutboundCallSession,
  type SoftphoneOptions,
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
const TONE_SECONDS = 2;
const TONE_AMPLITUDE = Math.round(0.25 * (2 ** 15 - 1));
const CALLER_TONE_HZ = 440;
const CALLEE_TONE_HZ = 880;
const FREQUENCY_TOLERANCE = 0.2;
const MIN_NON_SILENT_SECONDS = 0.5;
const SILENCE_THRESHOLD = 1000;
const DRAIN_INTERVAL_MS = 1_000;
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

type ToneFrame = { seconds: number; frequencyHz: number };

type ToneAnalysis = {
  medianFrequencyHz: number;
  nonSilentSeconds: number;
  frames: ToneFrame[];
};

const analyzeTone = (chunks: Buffer[]): ToneAnalysis => {
  const frames: ToneFrame[] = [];
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
      const seconds = sampleCount / SAMPLE_RATE;
      frames.push({ seconds, frequencyHz: crossings / seconds });
    }
  }
  const nonSilentSeconds = frames.reduce(
    (total, frame) => total + frame.seconds,
    0,
  );
  const estimates = frames
    .map((frame) => frame.frequencyHz)
    .sort((left, right) => left - right);
  const middle = Math.floor(estimates.length / 2);
  const medianFrequencyHz =
    estimates.length === 0
      ? 0
      : estimates.length % 2 === 1
        ? estimates[middle]
        : (estimates[middle - 1] + estimates[middle]) / 2;
  return { medianFrequencyHz, nonSilentSeconds, frames };
};

const matchedSeconds = (analysis: ToneAnalysis, expectedHz: number) =>
  analysis.frames
    .filter(
      (frame) =>
        Math.abs(frame.frequencyHz - expectedHz) <=
        expectedHz * FREQUENCY_TOLERANCE,
    )
    .reduce((total, frame) => total + frame.seconds, 0);

const toneEvidence = (
  phase: string,
  direction: string,
  expectedHz: number,
  analysis: ToneAnalysis,
  elapsedMs: number,
) =>
  `${phase} phase, ${direction}: expected peer tone ${expectedHz} Hz (±${Math.round(FREQUENCY_TOLERANCE * 100)}%), observed median ${analysis.medianFrequencyHz.toFixed(1)} Hz over ${Math.round(analysis.nonSilentSeconds * 1000)} ms of non-silent audio with ${Math.round(matchedSeconds(analysis, expectedHz) * 1000)} ms matching the peer tone, ${elapsedMs} ms into the exercise`;

const expectRecognizedTone = (
  analysis: ToneAnalysis,
  expectedHz: number,
  evidence: string,
) => {
  expect(analysis.nonSilentSeconds >= MIN_NON_SILENT_SECONDS, evidence).toBe(
    true,
  );
  expect(
    Math.abs(analysis.medianFrequencyHz - expectedHz) <=
      expectedHz * FREQUENCY_TOLERANCE,
    evidence,
  ).toBe(true);
};

const expectPeerToneAbsent = (
  analysis: ToneAnalysis,
  expectedHz: number,
  evidence: string,
) => {
  expect(
    matchedSeconds(analysis, expectedHz) < MIN_NON_SILENT_SECONDS,
    evidence,
  ).toBe(true);
};

const describeReceived = (
  analysis: ToneAnalysis | undefined,
  expectedHz: number,
) =>
  analysis === undefined
    ? "no audio observed yet"
    : `${Math.round(analysis.nonSilentSeconds * 1000)} ms of non-silent audio, median ${analysis.medianFrequencyHz.toFixed(1)} Hz, ${Math.round(matchedSeconds(analysis, expectedHz) * 1000)} ms within tolerance of the expected ${expectedHz} Hz`;

const hangUpBestEffort = async (session: CallSession | undefined) => {
  if (session === undefined) {
    return;
  }
  try {
    await session.hangup();
  } catch {
    return;
  }
};

describe("E2E call hold", () => {
  test("caller hold isolates peer audio in both directions until unhold restores it in a real call", async () => {
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
    let callFinished = false;

    try {
      await Promise.all([caller.register(), callee.register()]);

      const outbound = await caller.call(calleeOptions.username);
      outboundSession = outbound;
      const answeredPromise = once(outbound, "answered");
      const { session: inbound } = await inboundCallPromise;
      inboundSession = inbound;
      await answeredPromise;

      let callerReceived: Buffer[] = [];
      let calleeReceived: Buffer[] = [];
      outbound.on("audio", (audio) => callerReceived.push(audio));
      inbound.on("audio", (audio) => calleeReceived.push(audio));

      const exerciseStartedAt = Date.now();
      let currentPhase = "call setup";
      let holdSucceeded = false;
      let unholdSucceeded = false;
      let callerStreamingFinished = false;
      let calleeStreamingFinished = false;
      let callerAnalysis: ToneAnalysis | undefined;
      let calleeAnalysis: ToneAnalysis | undefined;

      const streamTones = () => {
        callerStreamingFinished = false;
        calleeStreamingFinished = false;
        const callerStreamer = outbound.streamAudio(
          generateTone(CALLER_TONE_HZ),
        );
        const calleeStreamer = inbound.streamAudio(
          generateTone(CALLEE_TONE_HZ),
        );
        const callerFinished = once(callerStreamer, "finished").then(() => {
          callerStreamingFinished = true;
        });
        const calleeFinished = once(calleeStreamer, "finished").then(() => {
          calleeStreamingFinished = true;
        });
        return Promise.all([callerFinished, calleeFinished]);
      };

      const exercise = (async () => {
        currentPhase = "normal";
        await streamTones();
        callerAnalysis = analyzeTone(callerReceived);
        calleeAnalysis = analyzeTone(calleeReceived);
        const normalElapsedMs = Date.now() - exerciseStartedAt;
        expectRecognizedTone(
          callerAnalysis,
          CALLEE_TONE_HZ,
          toneEvidence(
            "normal",
            "caller received audio",
            CALLEE_TONE_HZ,
            callerAnalysis,
            normalElapsedMs,
          ),
        );
        expectRecognizedTone(
          calleeAnalysis,
          CALLER_TONE_HZ,
          toneEvidence(
            "normal",
            "callee received audio",
            CALLER_TONE_HZ,
            calleeAnalysis,
            normalElapsedMs,
          ),
        );

        await sleep(DRAIN_INTERVAL_MS);
        currentPhase = "hold";
        await outbound.hold();
        holdSucceeded = true;
        callerReceived = [];
        calleeReceived = [];
        currentPhase = "held";
        await streamTones();
        callerAnalysis = analyzeTone(callerReceived);
        calleeAnalysis = analyzeTone(calleeReceived);
        const heldElapsedMs = Date.now() - exerciseStartedAt;
        expectPeerToneAbsent(
          callerAnalysis,
          CALLEE_TONE_HZ,
          toneEvidence(
            "held",
            "caller received audio",
            CALLEE_TONE_HZ,
            callerAnalysis,
            heldElapsedMs,
          ),
        );
        expectPeerToneAbsent(
          calleeAnalysis,
          CALLER_TONE_HZ,
          toneEvidence(
            "held",
            "callee received audio",
            CALLER_TONE_HZ,
            calleeAnalysis,
            heldElapsedMs,
          ),
        );

        await sleep(DRAIN_INTERVAL_MS);
        currentPhase = "unhold";
        await outbound.unhold();
        unholdSucceeded = true;
        callerReceived = [];
        calleeReceived = [];
        currentPhase = "restored";
        await streamTones();
        callerAnalysis = analyzeTone(callerReceived);
        calleeAnalysis = analyzeTone(calleeReceived);
        const restoredElapsedMs = Date.now() - exerciseStartedAt;
        expectRecognizedTone(
          callerAnalysis,
          CALLEE_TONE_HZ,
          toneEvidence(
            "restored",
            "caller received audio",
            CALLEE_TONE_HZ,
            callerAnalysis,
            restoredElapsedMs,
          ),
        );
        expectRecognizedTone(
          calleeAnalysis,
          CALLER_TONE_HZ,
          toneEvidence(
            "restored",
            "callee received audio",
            CALLER_TONE_HZ,
            calleeAnalysis,
            restoredElapsedMs,
          ),
        );
      })();

      let deadlineTimer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          reject(
            new Error(
              `hold/unhold exercise did not complete within ${EXERCISE_DEADLINE_MS} ms (phase: ${currentPhase}, caller streamer finished: ${callerStreamingFinished}, callee streamer finished: ${calleeStreamingFinished}, hold succeeded: ${holdSucceeded}, unhold succeeded: ${unholdSucceeded}, caller received: ${describeReceived(callerAnalysis, CALLEE_TONE_HZ)}, callee received: ${describeReceived(calleeAnalysis, CALLER_TONE_HZ)}, elapsed: ${Date.now() - exerciseStartedAt} ms)`,
            ),
          );
        }, EXERCISE_DEADLINE_MS);
      });
      try {
        await Promise.race([exercise, deadline]);
      } finally {
        clearTimeout(deadlineTimer);
      }

      const outboundDisposed = once(outbound, "disposed");
      const inboundDisposed = once(inbound, "disposed");
      await outbound.hangup();
      await Promise.all([outboundDisposed, inboundDisposed]);
      callFinished = true;
    } finally {
      if (!callFinished) {
        await hangUpBestEffort(outboundSession);
        await hangUpBestEffort(inboundSession);
      }
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
