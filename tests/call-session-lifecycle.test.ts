import { Buffer } from "node:buffer";
import dgram from "node:dgram";
import EventEmitter from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RtpHeader, SrtpSession } from "werift-rtp";

vi.mock("node:timers/promises", () => ({
  setTimeout: (delay: number) =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, delay);
    }),
}));

import CallSession from "../src/call-session/index.js";
import DTMF from "../src/dtmf.js";
import Softphone from "../src/index.js";
import { InboundMessage } from "../src/sip-message.js";
import { localKey } from "../src/utils.js";

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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CallSession lifecycle", () => {
  test("returns the bound socket after it starts listening", async () => {
    const udpSocket = bindingSocket("listening");

    await expect(CallSession.createBoundSocket()).resolves.toEqual({
      socket: udpSocket,
      port: 4321,
    });
    expect(udpSocket.bind).toHaveBeenCalledWith(0);
    expect(udpSocket.close).not.toHaveBeenCalled();
    expect(udpSocket.listenerCount("listening")).toBe(0);
    expect(udpSocket.listenerCount("error")).toBe(0);
  });

  test("closes the socket when binding fails", async () => {
    const error = new Error("bind failed");
    const udpSocket = bindingSocket("error", error);

    await expect(CallSession.createBoundSocket()).rejects.toBe(error);
    expect(udpSocket.close).toHaveBeenCalledOnce();
    expect(udpSocket.listenerCount("listening")).toBe(0);
    expect(udpSocket.listenerCount("error")).toBe(0);
  });

  test("creates the shared SDP body", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const phone = {
      client: { localAddress: "192.0.2.1" },
      codec: { id: 109, name: "OPUS/16000" },
    } as Softphone;

    expect(Softphone.prototype.createSdp.call(phone, 4000)).toBe(
      [
        "v=0",
        "o=- 1234 0 IN IP4 192.0.2.1",
        "s=rc-softphone-ts",
        "c=IN IP4 192.0.2.1",
        "t=0 0",
        "m=audio 4000 RTP/SAVP 109 101",
        "a=rtpmap:109 OPUS/16000",
        "a=rtpmap:101 telephone-event/8000",
        "a=fmtp:101 0-15",
        "a=sendrecv",
        `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${localKey}`,
      ].join("\n"),
    );
  });

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

  test("keeps the DTMF RTP and SRTP output unchanged", () => {
    const session = new TestCallSession(softphone(vi.fn()), message());
    const udpSocket = socket();
    const actualSrtp = createSrtpSession();
    const legacySrtp = createSrtpSession();
    const encrypt = vi.spyOn(actualSrtp, "encrypt");
    session.socket = udpSocket as unknown as dgram.Socket;
    session.srtpSession = actualSrtp;
    session.sequenceNumber = 42;
    session.timestamp = 1234;
    session.ssrc = 5678;

    session.sendDTMF("5");

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
    expect(session.sequenceNumber).toBe(48);
    expect(session.timestamp).toBe(2034);
  });
});
