import { once } from "node:events";
import { describe, expect, test } from "vitest";

import Softphone, {
  type CallSession,
  type InboundInvite,
  type OutboundCallSession,
  type SoftphoneOptions,
  type Streamer,
} from "../../src/index.js";
import { decodeMulawToPcm, encodePcmToMulaw } from "../mu-law.js";

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
const PCMU_SAMPLE_RATE = 8_000;
const STEREO_SAMPLE_RATE = 48_000;
const TONE_SECONDS = 1;
const TONE_AMPLITUDE = Math.round(0.25 * (2 ** 15 - 1));
const CALLER_TONE_HZ = 440;
const CALLEE_TONE_HZ = 880;
const FREQUENCY_TOLERANCE = 0.2;
const MIN_NON_SILENT_SECONDS = 0.5;
const SILENCE_THRESHOLD = 1000;
const EXCHANGE_DEADLINE_MS = 30_000;

const generateTone = (
  frequencyHz: number,
  sampleRate: number = SAMPLE_RATE,
) => {
  const sampleCount = sampleRate * TONE_SECONDS;
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index++) {
    pcm.writeInt16LE(
      Math.round(
        TONE_AMPLITUDE *
          Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate),
      ),
      index * 2,
    );
  }
  return pcm;
};

const generateStereoTone = (frequencyHz: number) => {
  const frameCount = STEREO_SAMPLE_RATE * TONE_SECONDS;
  const pcm = Buffer.alloc(frameCount * 4);
  for (let index = 0; index < frameCount; index++) {
    const sample = Math.round(
      TONE_AMPLITUDE *
        Math.sin((2 * Math.PI * frequencyHz * index) / STEREO_SAMPLE_RATE),
    );
    pcm.writeInt16LE(sample, index * 4);
    pcm.writeInt16LE(sample, index * 4 + 2);
  }
  return pcm;
};

type ToneAnalysis = {
  medianFrequencyHz: number;
  nonSilentSeconds: number;
};

const analyzeTone = (
  chunks: Buffer[],
  sampleRate: number = SAMPLE_RATE,
): ToneAnalysis => {
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
    (total, frame) => total + frame.samples / sampleRate,
    0,
  );
  const estimates = loudFrames
    .map((frame) => frame.crossings / (frame.samples / sampleRate))
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

const expectRecognizedTone = (
  analysis: ToneAnalysis,
  expectedHz: number,
  evidence?: string,
) => {
  const message =
    evidence ??
    `expected remote tone ${expectedHz} Hz, observed median ${analysis.medianFrequencyHz.toFixed(1)} Hz over ${Math.round(analysis.nonSilentSeconds * 1000)} ms of non-silent audio`;
  expect(analysis.nonSilentSeconds >= MIN_NON_SILENT_SECONDS, message).toBe(
    true,
  );
  expect(
    Math.abs(analysis.medianFrequencyHz - expectedHz) <=
      expectedHz * FREQUENCY_TOLERANCE,
    message,
  ).toBe(true);
};

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

const mixStereoToMono = (chunks: Buffer[]) =>
  chunks.map((chunk) => {
    const frameCount = Math.floor(chunk.length / 4);
    const mono = Buffer.alloc(frameCount * 2);
    for (let index = 0; index < frameCount; index++) {
      mono.writeInt16LE(
        (chunk.readInt16LE(index * 4) + chunk.readInt16LE(index * 4 + 2)) >> 1,
        index * 2,
      );
    }
    return mono;
  });

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

  test("caller and callee exchange recognizable PCMU audio in a real call", async () => {
    const callerOptions: SoftphoneOptions = {
      ...sipConfigFromPrefix("SIP_A"),
      codec: "PCMU/8000",
    };
    const calleeOptions: SoftphoneOptions = {
      ...sipConfigFromPrefix("SIP_B"),
      codec: "PCMU/8000",
    };
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
    let exchangeStartedAt = Date.now();
    let callerStreamingFinished = false;
    let calleeStreamingFinished = false;
    let callerAnalysis: ToneAnalysis | undefined;
    let calleeAnalysis: ToneAnalysis | undefined;

    const describeReception = (analysis: ToneAnalysis | undefined): string =>
      analysis === undefined
        ? "no audio observed yet"
        : `observed median ${analysis.medianFrequencyHz.toFixed(1)} Hz over ${Math.round(analysis.nonSilentSeconds * 1000)} ms of recognizable non-silent audio`;

    const evidence = (
      direction: string,
      selectedCodec: string,
      expectedHz: number,
      analysis: ToneAnalysis | undefined,
    ) =>
      `${direction}: expected peer tone ${expectedHz} Hz (±${Math.round(FREQUENCY_TOLERANCE * 100)}%), ${describeReception(analysis)}, caller streamer finished: ${callerStreamingFinished}, callee streamer finished: ${calleeStreamingFinished}, selected codec: ${selectedCodec}, elapsed: ${Date.now() - exchangeStartedAt} ms`;

    try {
      await Promise.all([caller.register(), callee.register()]);

      const outbound = await caller.call(calleeOptions.username);
      outboundSession = outbound;
      const answeredPromise = once(outbound, "answered");
      const { session: inbound } = await inboundCallPromise;
      inboundSession = inbound;
      await answeredPromise;

      const callerReceived: Buffer[] = [];
      const calleeReceived: Buffer[] = [];
      outbound.on("audio", (audio) => callerReceived.push(audio));
      inbound.on("audio", (audio) => calleeReceived.push(audio));

      exchangeStartedAt = Date.now();
      const callerStreamer = outbound.streamAudio(
        encodePcmToMulaw(generateTone(CALLER_TONE_HZ, PCMU_SAMPLE_RATE)),
      );
      const calleeStreamer = inbound.streamAudio(
        encodePcmToMulaw(generateTone(CALLEE_TONE_HZ, PCMU_SAMPLE_RATE)),
      );
      const callerFinished = once(callerStreamer, "finished").then(() => {
        callerStreamingFinished = true;
      });
      const calleeFinished = once(calleeStreamer, "finished").then(() => {
        calleeStreamingFinished = true;
      });

      const exchange = (async () => {
        await Promise.all([callerFinished, calleeFinished]);
        callerAnalysis = analyzeTone(
          callerReceived.map(decodeMulawToPcm),
          PCMU_SAMPLE_RATE,
        );
        calleeAnalysis = analyzeTone(
          calleeReceived.map(decodeMulawToPcm),
          PCMU_SAMPLE_RATE,
        );
        expectRecognizedTone(
          callerAnalysis,
          CALLEE_TONE_HZ,
          evidence(
            "caller received audio",
            caller.codec.name,
            CALLEE_TONE_HZ,
            callerAnalysis,
          ),
        );
        expectRecognizedTone(
          calleeAnalysis,
          CALLER_TONE_HZ,
          evidence(
            "callee received audio",
            callee.codec.name,
            CALLER_TONE_HZ,
            calleeAnalysis,
          ),
        );
      })();

      let deadlineTimer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          reject(
            new Error(
              `PCMU full-duplex audio exchange did not complete within ${EXCHANGE_DEADLINE_MS} ms (caller: ${evidence("caller received audio", caller.codec.name, CALLEE_TONE_HZ, callerAnalysis)}, callee: ${evidence("callee received audio", callee.codec.name, CALLER_TONE_HZ, calleeAnalysis)})`,
            ),
          );
        }, EXCHANGE_DEADLINE_MS);
      });
      try {
        await Promise.race([exchange, deadline]);
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

  test("caller and callee exchange recognizable OPUS/48000/2 audio in a real call", async () => {
    const callerOptions: SoftphoneOptions = {
      ...sipConfigFromPrefix("SIP_A"),
      codec: "OPUS/48000/2",
    };
    const calleeOptions: SoftphoneOptions = {
      ...sipConfigFromPrefix("SIP_B"),
      codec: "OPUS/48000/2",
    };
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
    let exchangeStartedAt = Date.now();
    let callerStreamingFinished = false;
    let calleeStreamingFinished = false;
    let callerStreamer: Streamer | undefined;
    let calleeStreamer: Streamer | undefined;
    let callerAnalysis: ToneAnalysis | undefined;
    let calleeAnalysis: ToneAnalysis | undefined;

    const describeReception = (analysis: ToneAnalysis | undefined): string =>
      analysis === undefined
        ? "no audio observed yet"
        : `observed median ${analysis.medianFrequencyHz.toFixed(1)} Hz over ${Math.round(analysis.nonSilentSeconds * 1000)} ms of recognizable non-silent audio`;

    const evidence = (
      direction: string,
      selectedCodec: string,
      expectedHz: number,
      analysis: ToneAnalysis | undefined,
    ) =>
      `${direction}: expected peer tone ${expectedHz} Hz (±${Math.round(FREQUENCY_TOLERANCE * 100)}%), ${describeReception(analysis)}, caller streamer finished: ${callerStreamingFinished}, callee streamer finished: ${calleeStreamingFinished}, selected codec: ${selectedCodec}, elapsed: ${Date.now() - exchangeStartedAt} ms`;

    const stereoDeadlineError = () =>
      `OPUS/48000/2 full-duplex audio exchange did not complete within ${EXCHANGE_DEADLINE_MS} ms (caller: ${evidence("caller received audio", caller.codec.name, CALLEE_TONE_HZ, callerAnalysis)}, callee: ${evidence("callee received audio", callee.codec.name, CALLER_TONE_HZ, calleeAnalysis)})`;

    try {
      await Promise.all([caller.register(), callee.register()]);

      const outbound = await caller.call(calleeOptions.username);
      outboundSession = outbound;
      const answeredPromise = once(outbound, "answered");
      const { session: inbound } = await inboundCallPromise;
      inboundSession = inbound;
      await answeredPromise;

      const callerReceived: Buffer[] = [];
      const calleeReceived: Buffer[] = [];
      outbound.on("audio", (audio) => callerReceived.push(audio));
      inbound.on("audio", (audio) => calleeReceived.push(audio));

      exchangeStartedAt = Date.now();
      callerStreamer = outbound.streamAudio(generateStereoTone(CALLER_TONE_HZ));
      calleeStreamer = inbound.streamAudio(generateStereoTone(CALLEE_TONE_HZ));
      const callerFinished = once(callerStreamer, "finished").then(() => {
        callerStreamingFinished = true;
      });
      const calleeFinished = once(calleeStreamer, "finished").then(() => {
        calleeStreamingFinished = true;
      });

      const exchange = (async () => {
        await Promise.all([callerFinished, calleeFinished]);
        callerAnalysis = analyzeTone(
          mixStereoToMono(callerReceived),
          STEREO_SAMPLE_RATE,
        );
        calleeAnalysis = analyzeTone(
          mixStereoToMono(calleeReceived),
          STEREO_SAMPLE_RATE,
        );
        expectRecognizedTone(
          callerAnalysis,
          CALLEE_TONE_HZ,
          evidence(
            "caller received audio",
            caller.codec.name,
            CALLEE_TONE_HZ,
            callerAnalysis,
          ),
        );
        expectRecognizedTone(
          calleeAnalysis,
          CALLER_TONE_HZ,
          evidence(
            "callee received audio",
            callee.codec.name,
            CALLER_TONE_HZ,
            calleeAnalysis,
          ),
        );
      })();

      let deadlineTimer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          reject(new Error(stereoDeadlineError()));
        }, EXCHANGE_DEADLINE_MS);
      });
      try {
        await Promise.race([exchange, deadline]);
      } finally {
        clearTimeout(deadlineTimer);
      }

      const outboundDisposed = once(outbound, "disposed");
      const inboundDisposed = once(inbound, "disposed");
      await outbound.hangup();
      await Promise.all([outboundDisposed, inboundDisposed]);
      callFinished = true;
    } finally {
      callerStreamer?.stop();
      calleeStreamer?.stop();
      if (!callFinished) {
        await hangUpBestEffort(outboundSession);
        await hangUpBestEffort(inboundSession);
      }
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
