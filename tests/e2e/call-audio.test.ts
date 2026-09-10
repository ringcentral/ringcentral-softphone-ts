import { once } from "node:events";
import { describe, expect, test } from "vitest";

import Softphone, {
  type InboundInvite,
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
const TONE_SECONDS = 1;
const TONE_AMPLITUDE = Math.round(0.25 * (2 ** 15 - 1));
const CALLER_TONE_HZ = 440;
const CALLEE_TONE_HZ = 880;
const FREQUENCY_TOLERANCE = 0.2;
const MIN_NON_SILENT_SECONDS = 0.5;
const SILENCE_THRESHOLD = 1000;
const EXCHANGE_DEADLINE_MS = 30_000;

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

const expectRecognizedTone = (analysis: ToneAnalysis, expectedHz: number) => {
  const message = `expected remote tone ${expectedHz} Hz, observed median ${analysis.medianFrequencyHz.toFixed(1)} Hz over ${Math.round(analysis.nonSilentSeconds * 1000)} ms of non-silent audio`;
  expect(analysis.nonSilentSeconds >= MIN_NON_SILENT_SECONDS, message).toBe(
    true,
  );
  expect(
    Math.abs(analysis.medianFrequencyHz - expectedHz) <=
      expectedHz * FREQUENCY_TOLERANCE,
    message,
  ).toBe(true);
};

describe("E2E call audio", () => {
  test("caller and callee exchange recognizable audio in a real call", async () => {
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

    try {
      await Promise.all([caller.register(), callee.register()]);

      const outboundSession = await caller.call(calleeOptions.username);
      const answeredPromise = once(outboundSession, "answered");
      const { session: inboundSession } = await inboundCallPromise;
      await answeredPromise;

      const callerReceived: Buffer[] = [];
      const calleeReceived: Buffer[] = [];
      outboundSession.on("audio", (audio) => callerReceived.push(audio));
      inboundSession.on("audio", (audio) => calleeReceived.push(audio));

      const callerStreamer = outboundSession.streamAudio(
        generateTone(CALLER_TONE_HZ),
      );
      const calleeStreamer = inboundSession.streamAudio(
        generateTone(CALLEE_TONE_HZ),
      );

      let callerStreamingFinished = false;
      let calleeStreamingFinished = false;
      const callerFinished = once(callerStreamer, "finished").then(() => {
        callerStreamingFinished = true;
      });
      const calleeFinished = once(calleeStreamer, "finished").then(() => {
        calleeStreamingFinished = true;
      });

      const exchange = (async () => {
        await Promise.all([callerFinished, calleeFinished]);
        const callerAnalysis = analyzeTone(callerReceived);
        const calleeAnalysis = analyzeTone(calleeReceived);
        expectRecognizedTone(callerAnalysis, CALLEE_TONE_HZ);
        expectRecognizedTone(calleeAnalysis, CALLER_TONE_HZ);
      })();

      let deadlineTimer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          reject(
            new Error(
              `full-duplex audio exchange did not complete within ${EXCHANGE_DEADLINE_MS} ms (caller streamer finished: ${callerStreamingFinished}, callee streamer finished: ${calleeStreamingFinished})`,
            ),
          );
        }, EXCHANGE_DEADLINE_MS);
      });
      try {
        await Promise.race([exchange, deadline]);
      } finally {
        clearTimeout(deadlineTimer);
      }

      const outboundDisposed = once(outboundSession, "disposed");
      const inboundDisposed = once(inboundSession, "disposed");
      await outboundSession.hangup();
      await Promise.all([outboundDisposed, inboundDisposed]);
    } finally {
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
