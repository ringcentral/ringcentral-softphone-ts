import dgram from "node:dgram";
import EventEmitter from "node:events";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RtpHeader, RtpPacket, SrtpSession } from "werift-rtp";

import { MediaTransport, Streamer } from "../src/call-session/media.js";
import type Codec from "../src/codec.js";
import * as DTMF from "../src/dtmf.js";

const packetSize = 4;

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

const createMedia = () => {
  const media = new MediaTransport(codec(), vi.fn());
  const sendAudio = vi.spyOn(media, "sendAudio").mockImplementation(() => {});
  return { media, sendAudio };
};

const socket = () =>
  Object.assign(new EventEmitter(), {
    send: vi.fn(),
    close: vi.fn(),
  });

const bindingSocket = (event: "listening" | "error", error?: Error) => {
  const udpSocket = Object.assign(new EventEmitter(), {
    bind: vi.fn(() => {
      queueMicrotask(() => udpSocket.emit(event, error));
    }),
    address: vi.fn(() => ({ port: 4321 })),
    close: vi.fn(),
  });
  vi.spyOn(dgram, "createSocket").mockReturnValue(
    udpSocket as unknown as dgram.Socket,
  );
  return udpSocket;
};

const createSrtpSession = () =>
  new SrtpSession({
    profile: 0x0001,
    keys: {
      localMasterKey: Buffer.alloc(16, 1),
      localMasterSalt: Buffer.alloc(14, 2),
      remoteMasterKey: Buffer.alloc(16, 3),
      remoteMasterSalt: Buffer.alloc(14, 4),
    },
  });

const incomingMedia = (
  decode = vi.fn((buffer: Buffer) => Buffer.from(buffer)),
) => {
  const emit = vi.fn();
  const udpSocket = socket();
  const media = new MediaTransport(codec(undefined, decode), emit);
  media.socket = udpSocket as unknown as dgram.Socket;
  media.remoteIP = "127.0.0.1";
  media.remotePort = 4000;
  media.srtpSession = {
    decrypt: (message: Buffer) => message,
  } as SrtpSession;
  media.start();
  return { decode, emit, media, udpSocket };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MediaTransport", () => {
  test("returns the bound socket after it starts listening", async () => {
    vi.useRealTimers();
    const udpSocket = bindingSocket("listening");

    await expect(MediaTransport.createBoundSocket()).resolves.toEqual({
      socket: udpSocket,
      port: 4321,
    });
    expect(udpSocket.bind).toHaveBeenCalledWith(0);
    expect(udpSocket.close).not.toHaveBeenCalled();
    expect(udpSocket.listenerCount("listening")).toBe(0);
    expect(udpSocket.listenerCount("error")).toBe(0);
  });

  test("closes the socket when binding fails", async () => {
    vi.useRealTimers();
    const error = new Error("bind failed");
    const udpSocket = bindingSocket("error", error);

    await expect(MediaTransport.createBoundSocket()).rejects.toBe(error);
    expect(udpSocket.close).toHaveBeenCalledOnce();
    expect(udpSocket.listenerCount("listening")).toBe(0);
    expect(udpSocket.listenerCount("error")).toBe(0);
  });

  test("encodes, encrypts, and sends audio while advancing RTP counters", () => {
    const encode = vi.fn(() => Buffer.from("encoded"));
    const media = new MediaTransport(codec(encode), vi.fn());
    const udpSocket = socket();
    const encrypt = vi.fn(() => Buffer.from("encrypted"));
    media.socket = udpSocket as unknown as dgram.Socket;
    media.remoteIP = "127.0.0.1";
    media.remotePort = 4000;
    media.srtpSession = { encrypt } as unknown as SrtpSession;
    media.sequenceNumber = 65535;
    media.timestamp = 10;
    media.ssrc = 20;

    const pcm = Buffer.alloc(packetSize);
    media.sendAudio(pcm);

    expect(encode).toHaveBeenCalledWith(pcm);
    expect(encrypt).toHaveBeenCalledWith(
      Buffer.from("encoded"),
      expect.objectContaining({
        payloadType: 0,
        sequenceNumber: 65535,
        timestamp: 10,
        ssrc: 20,
      }),
    );
    expect(udpSocket.send).toHaveBeenCalledWith(
      Buffer.from("encrypted"),
      4000,
      "127.0.0.1",
    );
    expect(media.sequenceNumber).toBe(0);
    expect(media.timestamp).toBe(14);
  });

  test("keeps the DTMF RTP and SRTP output unchanged", () => {
    const media = new MediaTransport(codec(), vi.fn());
    const udpSocket = socket();
    const actualSrtp = createSrtpSession();
    const legacySrtp = createSrtpSession();
    const encrypt = vi.spyOn(actualSrtp, "encrypt");
    media.socket = udpSocket as unknown as dgram.Socket;
    media.remoteIP = "127.0.0.1";
    media.remotePort = 4000;
    media.srtpSession = actualSrtp;
    media.sequenceNumber = 42;
    media.timestamp = 1234;
    media.ssrc = 5678;

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
      expect(encrypt).toHaveBeenNthCalledWith(
        index + 1,
        payload,
        expect.objectContaining({
          marker: index === 0,
          payloadType: 101,
          sequenceNumber: 42 + index,
          timestamp: 1234,
          ssrc: 5678,
        }),
      );
    }
    expect(media.sequenceNumber).toBe(48);
    expect(media.timestamp).toBe(2034);
  });

  test("emits raw and decoded audio events in order", () => {
    const decoded = Buffer.from("decoded");
    const decode = vi.fn(() => decoded);
    const { emit, udpSocket } = incomingMedia(decode);
    const packet = new RtpPacket(
      new RtpHeader({ payloadType: 0 }),
      Buffer.from("encoded"),
    );

    udpSocket.emit("message", packet.serialize());

    expect(decode).toHaveBeenCalledWith(Buffer.from("encoded"));
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      "rtpPacket",
      "audioPacket",
      "audio",
    ]);
    expect(emit).toHaveBeenLastCalledWith("audio", decoded);
  });

  test("emits raw and decoded DTMF events in order", () => {
    const { emit, udpSocket } = incomingMedia();
    const packet = new RtpPacket(
      new RtpHeader({ payloadType: 101 }),
      DTMF.charToPayloads("5")[0],
    );

    udpSocket.emit("message", packet.serialize());

    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      "rtpPacket",
      "dtmfPacket",
      "dtmf",
    ]);
    expect(emit).toHaveBeenLastCalledWith("dtmf", "5");
  });

  test("ignores embedded audio DTMF after the raw packet event", () => {
    const { decode, emit, udpSocket } = incomingMedia();
    const payload = Buffer.alloc(4);
    payload.writeUIntBE(0x8a03c0, 1, 3);
    const packet = new RtpPacket(new RtpHeader({ payloadType: 0 }), payload);

    udpSocket.emit("message", packet.serialize());

    expect(decode).not.toHaveBeenCalled();
    expect(emit.mock.calls.map(([event]) => event)).toEqual(["rtpPacket"]);
  });

  test("reports decode failures without emitting decoded audio", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { emit, udpSocket } = incomingMedia(
      vi.fn(() => {
        throw new Error("decode failed");
      }),
    );
    const packet = new RtpPacket(
      new RtpHeader({ payloadType: 0 }),
      Buffer.from("encoded"),
    );

    udpSocket.emit("message", packet.serialize());

    expect(error).toHaveBeenCalledOnce();
    expect(emit.mock.calls.map(([event]) => event)).toEqual(["rtpPacket"]);
  });

  test("removes socket listeners and closes the socket", () => {
    const media = new MediaTransport(codec(), vi.fn());
    const udpSocket = socket();
    const removeAllListeners = vi.spyOn(udpSocket, "removeAllListeners");
    media.socket = udpSocket as unknown as dgram.Socket;

    media.close();

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
    const { media, sendAudio } = createMedia();
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
    const { media, sendAudio } = createMedia();
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
    const { media, sendAudio } = createMedia();
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
    const { media, sendAudio } = createMedia();
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
    const { media, sendAudio } = createMedia();
    const streamer = new Streamer(media, Buffer.alloc(packetSize * 2));
    const finished = vi.fn();
    streamer.once("finished", finished);

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    media.disposed = true;
    await vi.advanceTimersByTimeAsync(20);

    expect(sendAudio).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();

    streamer.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(sendAudio).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
  });

  test("does not finish when disposed during the final send", async () => {
    const { media, sendAudio } = createMedia();
    const streamer = new Streamer(media, Buffer.alloc(packetSize));
    const finished = vi.fn();
    streamer.once("finished", finished);
    sendAudio.mockImplementationOnce(() => {
      media.disposed = true;
    });

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(sendAudio).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
  });
});
