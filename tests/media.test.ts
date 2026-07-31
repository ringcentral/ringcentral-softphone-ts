import dgram from "node:dgram";
import EventEmitter from "node:events";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RtpHeader, RtpPacket, SrtpSession } from "werift-rtp";

const randomInt = vi.hoisted(() => vi.fn(() => 1));
vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomInt,
}));

import { MediaTransport, Streamer } from "../src/call-session/media.js";
import type Codec from "../src/codec.js";
import * as DTMF from "../src/dtmf.js";
import { localKey } from "../src/utils.js";

const packetSize = 4;
const remoteKey = Buffer.alloc(30, 1).toString("base64");
const validSdp = [
  "v=0",
  "c=IN IP4 127.0.0.1",
  "m=audio 4000 RTP/SAVP 0",
  `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
].join("\r\n");

const codec = (
  encode = vi.fn((buffer: Buffer) => buffer),
  decode = vi.fn((buffer: Buffer) => buffer),
) =>
  ({
    id: 0,
    name: "PCMU/8000",
    packetSize,
    timestampInterval: packetSize,
    createEncoder: () => ({ encode }),
    createDecoder: () => ({ decode }),
  }) as Codec;

const socket = (event: "listening" | "error" = "listening", error?: Error) => {
  const udpSocket = Object.assign(new EventEmitter(), {
    bind: vi.fn(() => udpSocket.emit(event, error)),
    address: vi.fn(() => ({ port: 4321 })),
    send: vi.fn(),
    close: vi.fn(),
  });
  return udpSocket;
};

const bindMedia = async (selectedCodec = codec(), udpSocket = socket()) => {
  vi.spyOn(dgram, "createSocket").mockReturnValue(
    udpSocket as unknown as dgram.Socket,
  );
  const media = await MediaTransport.bind(selectedCodec);
  return { media, udpSocket };
};

const startMedia = async (
  selectedCodec = codec(),
  emit = vi.fn(),
  udpSocket = socket(),
) => {
  const bound = await bindMedia(selectedCodec, udpSocket);
  bound.media.start(validSdp, emit);
  bound.udpSocket.send.mockClear();
  return { ...bound, emit };
};

const createSrtpSession = () => {
  const localKeyBuffer = Buffer.from(localKey, "base64");
  const remoteKeyBuffer = Buffer.from(remoteKey, "base64");
  return new SrtpSession({
    profile: 0x0001,
    keys: {
      localMasterKey: localKeyBuffer.subarray(0, 16),
      localMasterSalt: localKeyBuffer.subarray(16, 30),
      remoteMasterKey: remoteKeyBuffer.subarray(0, 16),
      remoteMasterSalt: remoteKeyBuffer.subarray(16, 30),
    },
  });
};

const createRemoteSrtpSession = () => {
  const localKeyBuffer = Buffer.from(localKey, "base64");
  const remoteKeyBuffer = Buffer.from(remoteKey, "base64");
  return new SrtpSession({
    profile: 0x0001,
    keys: {
      localMasterKey: remoteKeyBuffer.subarray(0, 16),
      localMasterSalt: remoteKeyBuffer.subarray(16, 30),
      remoteMasterKey: localKeyBuffer.subarray(0, 16),
      remoteMasterSalt: localKeyBuffer.subarray(16, 30),
    },
  });
};

const createMedia = async () => {
  const { media } = await startMedia();
  const sendAudio = vi.spyOn(media, "sendAudio").mockImplementation(() => {});
  return { media, sendAudio };
};

const incomingMedia = async (
  decode = vi.fn((buffer: Buffer) => Buffer.from(buffer)),
) => {
  const started = await startMedia(codec(undefined, decode));
  return { ...started, remoteSrtp: createRemoteSrtpSession() };
};

beforeEach(() => {
  randomInt.mockReset();
  randomInt.mockReturnValue(1);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MediaTransport", () => {
  test("binds its socket and exposes the assigned local port", async () => {
    const udpSocket = socket();

    const { media } = await bindMedia(codec(), udpSocket);

    expect(media.localPort).toBe(4321);
    expect(udpSocket.bind).toHaveBeenCalledWith(0);
    expect(udpSocket.close).not.toHaveBeenCalled();
    expect(udpSocket.listenerCount("listening")).toBe(0);
    expect(udpSocket.listenerCount("error")).toBe(0);
  });

  test("closes the socket when binding fails", async () => {
    const error = new Error("bind failed");
    const udpSocket = socket("error", error);
    vi.spyOn(dgram, "createSocket").mockReturnValue(
      udpSocket as unknown as dgram.Socket,
    );

    await expect(MediaTransport.bind(codec())).rejects.toBe(error);
    expect(udpSocket.close).toHaveBeenCalledOnce();
    expect(udpSocket.listenerCount("listening")).toBe(0);
    expect(udpSocket.listenerCount("error")).toBe(0);
  });

  test("starts from negotiated SDP and rejects repeated startup", async () => {
    const emit = vi.fn();
    const { media, udpSocket } = await bindMedia();

    media.start(validSdp, emit);

    expect(udpSocket.send).toHaveBeenCalledWith("hello", 4000, "127.0.0.1");
    expect(udpSocket.listenerCount("message")).toBe(1);
    expect(() => media.start(validSdp, emit)).toThrow(
      "Media transport has already started",
    );
  });

  test.each([
    validSdp.replace("c=IN IP4 127.0.0.1", ""),
    validSdp.replace("m=audio 4000 RTP/SAVP 0", ""),
    validSdp.replace(
      `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
      "",
    ),
  ])("disposes when negotiated SDP is incomplete", async (sdp) => {
    const { media, udpSocket } = await bindMedia();

    expect(() => media.start(sdp, vi.fn())).toThrow(
      "negotiated SDP did not contain a remote IP, audio port, and SRTP key",
    );
    expect(media.disposed).toBe(true);
    expect(udpSocket.close).toHaveBeenCalledOnce();
  });

  test("rejects media operations before startup", async () => {
    const { media } = await bindMedia();
    const packet = new RtpPacket(new RtpHeader(), Buffer.alloc(0));

    expect(() => media.sendDTMF("1")).toThrow(
      "Media transport has not started",
    );
    expect(() => media.sendPacket(packet)).toThrow(
      "Media transport has not started",
    );
    expect(() => media.streamAudio(Buffer.alloc(0))).toThrow(
      "Media transport has not started",
    );
  });

  test("encodes, encrypts, and sends audio while rolling RTP counters", async () => {
    randomInt
      .mockReturnValueOnce(65535)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20);
    const encode = vi.fn(() => Buffer.from("encoded"));
    const encrypt = vi
      .spyOn(SrtpSession.prototype, "encrypt")
      .mockReturnValue(Buffer.from("encrypted"));
    const { media, udpSocket } = await startMedia(codec(encode));
    const pcm = Buffer.alloc(packetSize);

    media.sendAudio(pcm);
    media.sendAudio(pcm);

    expect(encode).toHaveBeenCalledWith(pcm);
    expect(encrypt).toHaveBeenNthCalledWith(
      1,
      Buffer.from("encoded"),
      expect.objectContaining({
        payloadType: 0,
        sequenceNumber: 65535,
        timestamp: 10,
        ssrc: 20,
      }),
    );
    expect(encrypt).toHaveBeenNthCalledWith(
      2,
      Buffer.from("encoded"),
      expect.objectContaining({
        sequenceNumber: 0,
        timestamp: 14,
      }),
    );
    expect(udpSocket.send).toHaveBeenCalledWith(
      Buffer.from("encrypted"),
      4000,
      "127.0.0.1",
    );
  });

  test("keeps the DTMF RTP and SRTP output unchanged", async () => {
    randomInt
      .mockReturnValueOnce(42)
      .mockReturnValueOnce(1234)
      .mockReturnValueOnce(5678);
    const { media, udpSocket } = await startMedia();
    const legacySrtp = createSrtpSession();

    media.sendDTMF("5");

    for (const [index, payload] of DTMF.charToPayloads("5").entries()) {
      const header = new RtpHeader({
        version: 2,
        padding: false,
        paddingSize: 0,
        extension: false,
        marker: index === 0,
        payloadOffset: 12,
        payloadType: 101,
        sequenceNumber: 42 + index,
        timestamp: 1234,
        ssrc: 5678,
        csrcLength: 0,
        csrc: [],
        extensionProfile: 48862,
        extensionLength: undefined,
        extensions: [],
      });
      expect(udpSocket.send.mock.calls[index]?.[0]).toEqual(
        legacySrtp.encrypt(payload, header),
      );
    }
  });

  test("emits raw and decoded audio events in order", async () => {
    const decoded = Buffer.from("decoded");
    const decode = vi.fn(() => decoded);
    const { emit, remoteSrtp, udpSocket } = await incomingMedia(decode);
    const packet = new RtpPacket(
      new RtpHeader({ payloadType: 0 }),
      Buffer.from("encoded"),
    );

    udpSocket.emit(
      "message",
      remoteSrtp.encrypt(packet.payload, packet.header),
    );

    expect(decode).toHaveBeenCalledWith(Buffer.from("encoded"));
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      "rtpPacket",
      "audioPacket",
      "audio",
    ]);
    expect(emit).toHaveBeenLastCalledWith("audio", decoded);
  });

  test("emits raw and decoded DTMF events in order", async () => {
    const { emit, remoteSrtp, udpSocket } = await incomingMedia();
    const packet = new RtpPacket(
      new RtpHeader({ payloadType: 101 }),
      DTMF.charToPayloads("5")[0],
    );

    udpSocket.emit(
      "message",
      remoteSrtp.encrypt(packet.payload, packet.header),
    );

    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      "rtpPacket",
      "dtmfPacket",
      "dtmf",
    ]);
    expect(emit).toHaveBeenLastCalledWith("dtmf", "5");
  });

  test("ignores embedded audio DTMF after the raw packet event", async () => {
    const { emit, remoteSrtp, udpSocket } = await incomingMedia();
    const payload = Buffer.alloc(4);
    payload.writeUIntBE(0x8a03c0, 1, 3);
    const packet = new RtpPacket(new RtpHeader({ payloadType: 0 }), payload);

    udpSocket.emit(
      "message",
      remoteSrtp.encrypt(packet.payload, packet.header),
    );

    expect(emit.mock.calls.map(([event]) => event)).toEqual(["rtpPacket"]);
  });

  test("reports decode failures without decoded audio events", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { emit, remoteSrtp, udpSocket } = await incomingMedia(
      vi.fn(() => {
        throw new Error("decode failed");
      }),
    );
    const packet = new RtpPacket(
      new RtpHeader({ payloadType: 0 }),
      Buffer.from("encoded"),
    );

    udpSocket.emit(
      "message",
      remoteSrtp.encrypt(packet.payload, packet.header),
    );

    expect(error).toHaveBeenCalledOnce();
    expect(emit.mock.calls.map(([event]) => event)).toEqual(["rtpPacket"]);
  });

  test("disposes once and cleans up the socket", async () => {
    const { media, udpSocket } = await startMedia();
    const removeAllListeners = vi.spyOn(udpSocket, "removeAllListeners");

    expect(media.dispose()).toBe(true);
    expect(media.dispose()).toBe(false);

    expect(media.disposed).toBe(true);
    expect(removeAllListeners).toHaveBeenCalledOnce();
    expect(udpSocket.close).toHaveBeenCalledOnce();
  });
});

describe("Streamer", () => {
  test.each([
    { name: "empty", size: 0, sends: 0 },
    { name: "sub-packet", size: packetSize - 1, sends: 0 },
    { name: "one-packet", size: packetSize, sends: 1 },
  ])("finishes $name input asynchronously", async ({ size, sends }) => {
    const { media, sendAudio } = await createMedia();
    const streamer = new Streamer(media, Buffer.alloc(size));
    const finished = vi.fn();

    streamer.start();
    streamer.once("finished", finished);

    expect(sendAudio).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);

    expect(sendAudio).toHaveBeenCalledTimes(sends);
    expect(finished).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toHaveBeenCalledOnce();
  });

  test("paces complete packets 20 ms apart and finishes once", async () => {
    const { media, sendAudio } = await createMedia();
    const streamer = new Streamer(media, Buffer.alloc(packetSize * 3 + 1));
    const finished = vi.fn();
    streamer.on("finished", finished);

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendAudio).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(19);
    expect(sendAudio).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(sendAudio).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(20);
    expect(sendAudio).toHaveBeenCalledTimes(3);
    expect(finished).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(100);
    expect(sendAudio).toHaveBeenCalledTimes(3);
    expect(finished).toHaveBeenCalledOnce();
  });

  test("pauses one run and ignores repeated pause and resume calls", async () => {
    const { media, sendAudio } = await createMedia();
    const streamer = new Streamer(media, Buffer.alloc(packetSize * 3));
    const finished = vi.fn();
    streamer.once("finished", finished);

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    streamer.pause();
    streamer.pause();
    await vi.advanceTimersByTimeAsync(100);
    expect(sendAudio).toHaveBeenCalledOnce();

    streamer.resume();
    streamer.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendAudio).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(sendAudio).toHaveBeenCalledTimes(3);
    expect(finished).toHaveBeenCalledOnce();
  });

  test("stops permanently until start restarts the original buffer", async () => {
    const { media, sendAudio } = await createMedia();
    const streamer = new Streamer(media, Buffer.alloc(packetSize * 2));
    const finished = vi.fn();
    streamer.on("finished", finished);

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    streamer.stop();
    streamer.stop();
    streamer.resume();
    streamer.resume();
    await vi.advanceTimersByTimeAsync(100);
    expect(sendAudio).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();

    streamer.start();
    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(sendAudio).toHaveBeenCalledTimes(3);
    expect(finished).toHaveBeenCalledOnce();

    streamer.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(sendAudio).toHaveBeenCalledTimes(5);
    expect(finished).toHaveBeenCalledTimes(2);
  });

  test("does not send or finish after disposal", async () => {
    const { media, sendAudio } = await createMedia();
    const streamer = new Streamer(media, Buffer.alloc(packetSize * 2));
    const finished = vi.fn();
    streamer.once("finished", finished);

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    media.dispose();
    await vi.advanceTimersByTimeAsync(20);

    expect(sendAudio).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();

    streamer.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(sendAudio).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
  });

  test("does not finish when disposed during the final send", async () => {
    const { media, sendAudio } = await createMedia();
    const streamer = new Streamer(media, Buffer.alloc(packetSize));
    const finished = vi.fn();
    streamer.once("finished", finished);
    sendAudio.mockImplementationOnce(() => {
      media.dispose();
    });

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(sendAudio).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
  });
});
