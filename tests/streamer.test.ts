import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type CallSession from "../src/call-session/index.js";
import Streamer from "../src/call-session/streamer.js";

const packetSize = 4;

const createCallSession = () => {
  const send = vi.fn();
  const encode = vi.fn((buffer: Buffer) => buffer);
  const encrypt = vi.fn((buffer: Buffer, _header: unknown) => buffer);
  const callSession = {
    disposed: false,
    encoder: { encode },
    send,
    sequenceNumber: 1,
    timestamp: 1,
    ssrc: 1,
    softphone: {
      codec: {
        id: 0,
        packetSize,
        timestampInterval: packetSize,
      },
    },
    srtpSession: { encrypt },
  } as unknown as CallSession;

  return { callSession, encode, encrypt, send };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Streamer", () => {
  test.each([
    { name: "empty", size: 0, sends: 0 },
    { name: "sub-packet", size: packetSize - 1, sends: 0 },
    { name: "one-packet", size: packetSize, sends: 1 },
  ])("finishes $name input asynchronously", async ({ size, sends }) => {
    const { callSession, send } = createCallSession();
    const streamer = new Streamer(callSession, Buffer.alloc(size));
    const finished = vi.fn();

    streamer.start();
    streamer.once("finished", finished);

    expect(send).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledTimes(sends);
    expect(finished).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toHaveBeenCalledOnce();
  });

  test("paces complete packets 20 ms apart and finishes once", async () => {
    const { callSession, encode, encrypt, send } = createCallSession();
    const streamer = new Streamer(
      callSession,
      Buffer.alloc(packetSize * 3 + 1),
    );
    const finished = vi.fn();
    streamer.on("finished", finished);

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledOnce();
    expect(encrypt).toHaveBeenNthCalledWith(
      1,
      Buffer.alloc(packetSize),
      expect.objectContaining({
        payloadType: 0,
        sequenceNumber: 1,
        timestamp: 1,
        ssrc: 1,
      }),
    );
    expect(finished).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(19);
    expect(send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(20);
    expect(send).toHaveBeenCalledTimes(3);
    expect(encode).toHaveBeenCalledTimes(3);
    expect(finished).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(3);
    expect(finished).toHaveBeenCalledOnce();
  });

  test("wraps the sequence number from 65535 to 0", async () => {
    const { callSession } = createCallSession();
    callSession.sequenceNumber = 65535;
    const streamer = new Streamer(callSession, Buffer.alloc(packetSize));

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(callSession.sequenceNumber).toBe(0);
  });

  test("pauses one run and ignores repeated pause and resume calls", async () => {
    const { callSession, send } = createCallSession();
    const streamer = new Streamer(callSession, Buffer.alloc(packetSize * 3));
    const finished = vi.fn();
    streamer.once("finished", finished);

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    streamer.pause();
    streamer.pause();
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledOnce();

    streamer.resume();
    streamer.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(send).toHaveBeenCalledTimes(3);
    expect(finished).toHaveBeenCalledOnce();
  });

  test("stops permanently until start restarts the original buffer", async () => {
    const { callSession, send } = createCallSession();
    const streamer = new Streamer(callSession, Buffer.alloc(packetSize * 2));
    const finished = vi.fn();
    streamer.on("finished", finished);

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    streamer.stop();
    streamer.stop();
    streamer.resume();
    streamer.resume();
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();

    streamer.start();
    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(send).toHaveBeenCalledTimes(3);
    expect(finished).toHaveBeenCalledOnce();

    streamer.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(send).toHaveBeenCalledTimes(5);
    expect(finished).toHaveBeenCalledTimes(2);
  });

  test("does not send or finish after call disposal", async () => {
    const { callSession, send } = createCallSession();
    const streamer = new Streamer(callSession, Buffer.alloc(packetSize * 2));
    const finished = vi.fn();
    streamer.once("finished", finished);

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    callSession.disposed = true;
    await vi.advanceTimersByTimeAsync(20);

    expect(send).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();

    streamer.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
  });

  test("does not finish when the call is disposed during the final send", async () => {
    const { callSession, send } = createCallSession();
    const streamer = new Streamer(callSession, Buffer.alloc(packetSize));
    const finished = vi.fn();
    streamer.once("finished", finished);
    send.mockImplementationOnce(() => {
      callSession.disposed = true;
    });

    streamer.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(send).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
  });
});
