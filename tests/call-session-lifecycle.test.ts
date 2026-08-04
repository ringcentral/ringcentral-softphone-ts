import EventEmitter from "node:events";

import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:timers/promises", () => ({
  setTimeout: (delay: number) =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, delay);
    }),
}));

import type InboundCallSession from "../src/call-session/inbound.js";
import { type RtpPacket, SrtpSession } from "../src/rtp/index.js";
import { InboundMessage, type OutboundMessage } from "../src/sip-message.js";
import type { InboundInvite } from "../src/types.js";
import { localKey } from "../src/utils.js";
import {
  createSignaling,
  createSocket,
  createSoftphone,
  signalingMessage,
  useSocket,
} from "./call-session-fixture.js";

const remoteKey = Buffer.alloc(30, 1).toString("base64");
const sdp = (ip = "127.0.0.1", port = 4000) =>
  [
    "v=0",
    `c=IN IP4 ${ip}`,
    `m=audio ${port} RTP/SAVP 0`,
    `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
  ].join("\r\n");

const invite = (body: string, callId = "call-123") =>
  new InboundMessage(
    "INVITE sip:1001@example.com SIP/2.0",
    {
      "Call-ID": callId,
      From: "<sip:1002@example.com>;tag=remote",
      To: "<sip:1001@example.com>;tag=local",
      Via: "SIP/2.0/TLS remote.example.com;branch=branch",
      CSeq: "1 INVITE",
    },
    body,
  );

const createRemoteSrtpSession = () => {
  const localKeyBuffer = Buffer.from(localKey, "base64");
  const remoteKeyBuffer = Buffer.from(remoteKey, "base64");
  return new SrtpSession(remoteKeyBuffer, localKeyBuffer);
};

const audioPacket: RtpPacket = {
  header: {
    marker: false,
    payloadType: 0,
    sequenceNumber: 0,
    timestamp: 0,
    ssrc: 0,
  },
  payload: Buffer.from("audio"),
};

const createAnsweredSession = async ({
  inviteSdp = sdp(),
  ackSdp = "",
  request = vi.fn(async (_outbound: OutboundMessage) =>
    signalingMessage({
      subject: "ACK sip:1001@example.com SIP/2.0",
      cseq: "1 ACK",
      body: ackSdp,
    }),
  ),
} = {}) => {
  const signaling = createSignaling(request);
  const softphone = createSoftphone(signaling);
  const socket = createSocket();
  useSocket(socket);
  const session = (await softphone.answer(
    invite(inviteSdp) as unknown as InboundInvite,
  )) as InboundCallSession;
  return { request, session, signaling, socket, softphone };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CallSession lifecycle", () => {
  test("creates the shared SDP body", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const signaling = createSignaling();
    const softphone = createSoftphone(signaling, { codec: "OPUS/16000" });

    expect(softphone.createSdp(4000)).toBe(
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

  test("disposes media before emitting disposed and removes signaling", async () => {
    const fixture = await createAnsweredSession();
    const disposed = vi.fn(() => {
      expect(fixture.session.media.disposed).toBe(true);
      expect(fixture.socket.close).toHaveBeenCalledOnce();
    });
    fixture.session.on("disposed", disposed);

    expect(fixture.session).toBeInstanceOf(EventEmitter);
    expect(fixture.signaling.listenerCount("message")).toBe(2);
    await fixture.session.hangup();
    await fixture.session.hangup();

    expect(fixture.signaling.send.mock.calls[0][0].subject).toMatch(/^BYE /);
    expect(disposed).toHaveBeenCalledOnce();
    expect(fixture.socket.close).toHaveBeenCalledOnce();
    expect(fixture.signaling.listenerCount("message")).toBe(1);
  });

  test("does not dispose when the local hangup request fails", async () => {
    const fixture = await createAnsweredSession();
    fixture.signaling.send.mockImplementationOnce(() => {
      throw new Error("send failed");
    });

    await expect(fixture.session.hangup()).rejects.toThrow("send failed");
    expect(fixture.session.media.disposed).toBe(false);
    expect(fixture.signaling.listenerCount("message")).toBe(2);
  });

  test("keeps the delay after each DTMF character", async () => {
    vi.useFakeTimers();
    const fixture = await createAnsweredSession();
    const sendDTMF = vi
      .spyOn(fixture.session, "sendDTMF")
      .mockImplementation(() => {});

    const sending = fixture.session.sendDTMFs("12", 500);
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

  test("forwards media events through the real call session", async () => {
    const fixture = await createAnsweredSession();
    const remoteSrtp = createRemoteSrtpSession();
    const raw = vi.fn();
    const audio = vi.fn();
    fixture.session.on("rtpPacket", raw);
    fixture.session.on("audio", audio);

    fixture.socket.emit(
      "message",
      remoteSrtp.encrypt(audioPacket.payload, audioPacket.header),
    );

    expect(raw).toHaveBeenCalledOnce();
    expect(audio).toHaveBeenCalledWith(Buffer.from("audio"));
  });

  test("handles remote BYE independently of Softphone listeners", async () => {
    const fixture = await createAnsweredSession();
    const raw = vi.fn();
    const disposed = vi.fn();
    fixture.softphone.on("message", raw);
    fixture.session.on("disposed", disposed);

    fixture.signaling.emit(
      "message",
      signalingMessage({
        subject: "BYE sip:1001@example.com SIP/2.0",
        callId: "another-call",
        cseq: "2 BYE",
      }),
    );
    expect(raw).toHaveBeenCalledOnce();
    expect(disposed).not.toHaveBeenCalled();

    fixture.softphone.removeAllListeners();
    fixture.signaling.emit(
      "message",
      signalingMessage({
        subject: "BYE sip:1001@example.com SIP/2.0",
        cseq: "2 BYE",
      }),
    );

    expect(disposed).toHaveBeenCalledOnce();
    expect(fixture.signaling.listenerCount("message")).toBe(1);
  });

  test("matches transfer NOTIFY by call and rejects overlapping transfers", async () => {
    const fixture = await createAnsweredSession();
    const transfer = fixture.session.transfer("1003");

    await expect(fixture.session.transfer("1004")).rejects.toThrow(
      "A call transfer is already pending",
    );
    expect(fixture.signaling.send.mock.calls[0][0].subject).toMatch(/^REFER /);

    fixture.signaling.emit(
      "message",
      signalingMessage({
        subject: "NOTIFY sip:1001@example.com SIP/2.0",
        callId: "another-call",
        cseq: "2 NOTIFY",
        body: "SIP/2.0 200 OK",
      }),
    );
    expect(fixture.signaling.send).toHaveBeenCalledOnce();

    fixture.signaling.emit(
      "message",
      signalingMessage({
        subject: "NOTIFY sip:1001@example.com SIP/2.0",
        cseq: "2 NOTIFY",
        body: "SIP/2.0 200 OK",
      }),
    );
    await transfer;

    expect(fixture.signaling.send).toHaveBeenCalledTimes(2);
    expect(fixture.signaling.send.mock.calls[1][0].subject).toBe(
      "SIP/2.0 200 OK",
    );
  });

  test("rejects a pending transfer when the call is disposed", async () => {
    const fixture = await createAnsweredSession();
    const transfer = fixture.session.transfer("1003");
    const rejected = expect(transfer).rejects.toThrow(
      "Call session was disposed",
    );

    await fixture.session.hangup();
    await rejected;
  });

  test("sends re-INVITE and ACK for hold and unhold", async () => {
    const request = vi.fn(async (outbound: OutboundMessage) => {
      if (request.mock.calls.length === 1) {
        return signalingMessage({
          subject: "ACK sip:1001@example.com SIP/2.0",
          cseq: "1 ACK",
        });
      }
      return signalingMessage({ cseq: outbound.headers.CSeq });
    });
    const fixture = await createAnsweredSession({ request });

    await fixture.session.hold();
    await fixture.session.unhold();

    expect(request.mock.calls[1][0].body).toContain("a=sendonly");
    expect(request.mock.calls[2][0].body).toContain("a=sendrecv");
    expect(fixture.signaling.send).toHaveBeenCalledTimes(2);
    expect(fixture.signaling.send.mock.calls[0][0].subject).toMatch(/^ACK /);
    expect(fixture.signaling.send.mock.calls[1][0].subject).toMatch(/^ACK /);
  });
});

describe("inbound media setup", () => {
  test.each([
    {
      name: "uses ACK SDP when present",
      inviteSdp: sdp("192.0.2.10", 4000),
      ackSdp: sdp("192.0.2.20", 5000),
      expectedIP: "192.0.2.20",
      expectedPort: 5000,
    },
    {
      name: "falls back to INVITE SDP",
      inviteSdp: sdp("192.0.2.10", 4000),
      ackSdp: "",
      expectedIP: "192.0.2.10",
      expectedPort: 4000,
    },
  ])("$name", async ({ inviteSdp, ackSdp, expectedIP, expectedPort }) => {
    const fixture = await createAnsweredSession({ inviteSdp, ackSdp });

    expect(fixture.socket.send).toHaveBeenCalledWith(
      "hello",
      expectedPort,
      expectedIP,
    );
  });

  test("closes media and signaling listener when inbound setup fails", async () => {
    const signaling = createSignaling(
      vi.fn(async () =>
        signalingMessage({
          subject: "ACK sip:1001@example.com SIP/2.0",
          cseq: "1 ACK",
        }),
      ),
    );
    const softphone = createSoftphone(signaling);
    const socket = createSocket();
    useSocket(socket);

    await expect(
      softphone.answer(invite("") as unknown as InboundInvite),
    ).rejects.toThrow("negotiated SDP did not contain");
    expect(socket.close).toHaveBeenCalledOnce();
    expect(signaling.listenerCount("message")).toBe(1);
  });
});
