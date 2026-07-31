import type dgram from "node:dgram";
import EventEmitter from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RtpHeader, RtpPacket, type SrtpSession } from "werift-rtp";

vi.mock("node:timers/promises", () => ({
  setTimeout: (delay: number) =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, delay);
    }),
}));

import CallSession from "../src/call-session/index.js";
import Softphone from "../src/index.js";
import { InboundMessage } from "../src/sip-message.js";
import { localKey } from "../src/utils.js";

class TestCallSession extends CallSession {
  public startMedia() {
    this.startLocalServices();
  }
}

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
  Object.assign(new EventEmitter(), {
    sipInfo: { domain: "example.com" },
    fakeDomain: "client.invalid",
    codec: {
      id: 0,
      packetSize: 160,
      timestampInterval: 160,
      createEncoder: () => ({ encode: (input: Buffer) => input }),
      createDecoder: () => ({ decode: (input: Buffer) => input }),
    },
    send,
  }) as unknown as Softphone;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CallSession lifecycle", () => {
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
    session.media.socket = udpSocket as unknown as dgram.Socket;
    session.localPeer = "<sip:1001@example.com>;tag=local";
    session.remotePeer = "<sip:1002@example.com>;tag=remote";
    const disposed = vi.fn();
    session.on("disposed", disposed);

    expect(session).toBeInstanceOf(EventEmitter);
    expect(session.sipMessage).toBe(sipMessage);
    await session.hangup();
    await session.hangup();

    expect(session.media.disposed).toBe(true);
    expect(disposed).toHaveBeenCalledOnce();
    expect(udpSocket.removeAllListeners).toHaveBeenCalledOnce();
    expect(udpSocket.close).toHaveBeenCalledOnce();
  });

  test("does not dispose when the local hangup request fails", async () => {
    const session = new TestCallSession(
      softphone(vi.fn(async () => Promise.reject(new Error("send failed")))),
      message(),
    );
    session.media.socket = socket() as unknown as dgram.Socket;
    session.localPeer = "<sip:1001@example.com>;tag=local";
    session.remotePeer = "<sip:1002@example.com>;tag=remote";

    await expect(session.hangup()).rejects.toThrow("send failed");
    expect(session.media.disposed).toBe(false);
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

  test("forwards media events through the call session", () => {
    const session = new TestCallSession(softphone(vi.fn()), message());
    const udpSocket = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      close: vi.fn(),
    });
    session.media.socket = udpSocket as unknown as dgram.Socket;
    session.media.remoteIP = "127.0.0.1";
    session.media.remotePort = 4000;
    session.media.srtpSession = {
      decrypt: (input: Buffer) => input,
    } as SrtpSession;
    const raw = vi.fn();
    const audio = vi.fn();
    session.on("rtpPacket", raw);
    session.on("audio", audio);

    session.startMedia();
    udpSocket.emit(
      "message",
      new RtpPacket(
        new RtpHeader({ payloadType: 0 }),
        Buffer.from("audio"),
      ).serialize(),
    );

    expect(raw).toHaveBeenCalledOnce();
    expect(audio).toHaveBeenCalledWith(Buffer.from("audio"));
  });
});
