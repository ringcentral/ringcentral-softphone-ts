import type dgram from "node:dgram";
import EventEmitter from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:timers/promises", () => ({
  setTimeout: (delay: number) =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, delay);
    }),
}));

import CallSession from "../src/call-session/index.js";
import type Softphone from "../src/index.js";
import { InboundMessage } from "../src/sip-message.js";

class TestCallSession extends CallSession {}

const message = () =>
  InboundMessage.fromString(
    [
      "SIP/2.0 200 OK",
      "Call-ID: call-123",
      "From: <sip:1001@example.com>;tag=local",
      "To: <sip:1002@example.com>;tag=remote",
      "CSeq: 1 INVITE",
      "Content-Length: 0",
      "",
      "",
    ].join("\r\n"),
  );

const socket = () => ({
  send: vi.fn(),
  removeAllListeners: vi.fn(),
  close: vi.fn(),
});

const softphone = (send: ReturnType<typeof vi.fn>) =>
  ({
    sipInfo: { domain: "example.com" },
    fakeDomain: "client.invalid",
    codec: {
      createEncoder: () => ({ encode: vi.fn() }),
      createDecoder: () => ({ decode: vi.fn() }),
    },
    send,
  }) as unknown as Softphone;

afterEach(() => {
  vi.useRealTimers();
});

describe("CallSession lifecycle", () => {
  test("disposes once after a successful local hangup", async () => {
    const send = vi.fn(async () => {});
    const sipMessage = message();
    const session = new TestCallSession(softphone(send), sipMessage);
    const udpSocket = socket();
    session.socket = udpSocket as unknown as dgram.Socket;
    session.localPeer = "<sip:1001@example.com>;tag=local";
    session.remotePeer = "<sip:1002@example.com>;tag=remote";
    const disposed = vi.fn();
    session.on("disposed", disposed);

    expect(session).toBeInstanceOf(EventEmitter);
    expect(session.sipMessage).toBe(sipMessage);
    await session.hangup();
    await session.hangup();

    expect(session.disposed).toBe(true);
    expect(disposed).toHaveBeenCalledOnce();
    expect(udpSocket.removeAllListeners).toHaveBeenCalledOnce();
    expect(udpSocket.close).toHaveBeenCalledOnce();
  });

  test("does not dispose when the local hangup request fails", async () => {
    const session = new TestCallSession(
      softphone(vi.fn(async () => Promise.reject(new Error("send failed")))),
      message(),
    );
    session.socket = socket() as unknown as dgram.Socket;
    session.localPeer = "<sip:1001@example.com>;tag=local";
    session.remotePeer = "<sip:1002@example.com>;tag=remote";

    await expect(session.hangup()).rejects.toThrow("send failed");
    expect(session.disposed).toBe(false);
  });

  test("keeps the delay after each DTMF character", async () => {
    vi.useFakeTimers();
    const session = new TestCallSession(softphone(vi.fn()), message());
    const sendDTMF = vi.spyOn(session, "sendDTMF").mockImplementation(() => {});

    const sending = session.sendDTMFs("12", 500);
    expect(sendDTMF).toHaveBeenNthCalledWith(1, "1");

    await vi.advanceTimersByTimeAsync(500);
    expect(sendDTMF).toHaveBeenNthCalledWith(2, "2");

    let finished = false;
    void sending.then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sending;
    expect(finished).toBe(true);
  });
});
