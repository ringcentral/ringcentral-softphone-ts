import dgram from "node:dgram";

import { afterEach, describe, expect, test, vi } from "vitest";

import type { InboundMessage, OutboundMessage } from "../src/sip-message.js";
import {
  createSignaling,
  createSocket,
  createSoftphone,
  signalingMessage,
  useSocket,
} from "./call-session-fixture.js";

const remoteKey = Buffer.alloc(30, 1).toString("base64");
const validSdp = [
  "v=0",
  "c=IN IP4 127.0.0.1",
  "m=audio 4000 RTP/SAVP 0",
  `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
].join("\r\n");

const setupCall = (
  progress: (cseq: string, callId: string) => InboundMessage,
) => {
  const socket = createSocket(4000);
  let progressCseq = "";
  let callId = "";
  const request = vi.fn(async (message: OutboundMessage) => {
    if (request.mock.calls.length === 1) {
      return signalingMessage({
        subject: "SIP/2.0 407 Proxy Authentication Required",
        callId: message.headers["Call-ID"],
        cseq: message.headers.CSeq,
        headers: {
          "Proxy-Authenticate": 'Digest realm="example.com", nonce="nonce"',
        },
      });
    }
    progressCseq = message.headers.CSeq;
    callId = message.headers["Call-ID"];
    return progress(progressCseq, callId);
  });
  const signaling = createSignaling(request);
  const softphone = createSoftphone(signaling);
  useSocket(socket);

  return {
    callId: () => callId,
    progressCseq: () => progressCseq,
    request,
    signaling,
    socket,
    softphone,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("outbound call responses", () => {
  test("accepts 183 with SDP followed by 200 through SipTransport", async () => {
    const fixture = setupCall((cseq, callId) =>
      signalingMessage({
        subject: "SIP/2.0 183 Session Progress",
        callId,
        cseq,
        body: validSdp,
      }),
    );
    const session = await fixture.softphone.call("1002");
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(
      fixture.request.mock.calls[1][0].headers["Proxy-Authorization"],
    ).toContain('nonce="nonce"');
    const answered = vi.fn(() => {
      expect(fixture.socket.send).toHaveBeenCalledWith(
        "hello",
        4000,
        "127.0.0.1",
      );
      expect(fixture.signaling.send).not.toHaveBeenCalled();
    });
    const raw = vi.fn();
    session.on("answered", answered);
    fixture.softphone.on("message", raw);
    expect(() => session.sendDTMF("1")).toThrow(
      "Media transport has not started",
    );

    fixture.signaling.emit(
      "message",
      signalingMessage({
        subject: "INFO sip:1001@example.com SIP/2.0",
        callId: fixture.callId(),
        cseq: "99 INFO",
      }),
    );
    expect(raw).toHaveBeenCalledOnce();
    fixture.softphone.removeAllListeners();

    const ok = signalingMessage({
      callId: fixture.callId(),
      cseq: fixture.progressCseq(),
    });
    fixture.signaling.emit("message", ok);
    fixture.signaling.emit("message", ok);

    expect(answered).toHaveBeenCalledOnce();
    expect(fixture.signaling.send).toHaveBeenCalledOnce();
    const ack = fixture.signaling.send.mock.calls[0][0];
    expect(ack.subject).toMatch(/^ACK /);
    expect(ack.headers.CSeq).toBe(
      fixture.progressCseq().replace(" INVITE", " ACK"),
    );
  });

  test.each(["180 Ringing", "200 OK", "486 Busy Here"])(
    "rejects an initial %s response and closes the socket",
    async (status) => {
      const fixture = setupCall((cseq, callId) =>
        signalingMessage({
          subject: `SIP/2.0 ${status}`,
          callId,
          cseq,
        }),
      );

      await expect(fixture.softphone.call("1002")).rejects.toThrow(
        `expected 183 Session Progress, received SIP/2.0 ${status}`,
      );
      expect(fixture.socket.close).toHaveBeenCalledOnce();
    },
  );

  test.each([
    validSdp.replace("c=IN IP4 127.0.0.1", ""),
    validSdp.replace("m=audio 4000 RTP/SAVP 0", ""),
    validSdp.replace(
      `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
      "",
    ),
  ])("rejects incomplete 183 SDP and closes the socket", async (sdp) => {
    const fixture = setupCall((cseq, callId) =>
      signalingMessage({
        subject: "SIP/2.0 183 Session Progress",
        callId,
        cseq,
        body: sdp,
      }),
    );

    await expect(fixture.softphone.call("1002")).rejects.toThrow(
      "183 Session Progress did not contain usable SDP",
    );
    expect(fixture.socket.close).toHaveBeenCalledOnce();
  });

  test("closes bound media when SIP setup fails", async () => {
    const fixture = setupCall((cseq, callId) =>
      signalingMessage({
        subject: "SIP/2.0 183 Session Progress",
        callId,
        cseq,
        body: validSdp,
      }),
    );
    fixture.request.mockRejectedValueOnce(new Error("send failed"));

    await expect(fixture.softphone.call("1002")).rejects.toThrow("send failed");
    expect(fixture.socket.close).toHaveBeenCalledOnce();
  });

  test("treats a matching non-200 response as busy", async () => {
    const fixture = setupCall((cseq, callId) =>
      signalingMessage({
        subject: "SIP/2.0 183 Session Progress",
        callId,
        cseq,
        body: validSdp,
      }),
    );
    const session = await fixture.softphone.call("1002");
    const busy = vi.fn(() => {
      expect(fixture.socket.close).not.toHaveBeenCalled();
    });
    const disposed = vi.fn();
    session.on("busy", busy);
    session.on("disposed", disposed);

    fixture.signaling.emit(
      "message",
      signalingMessage({
        subject: "SIP/2.0 480 Temporarily Unavailable",
        callId: "another-call",
        cseq: fixture.progressCseq(),
      }),
    );
    fixture.signaling.emit(
      "message",
      signalingMessage({
        subject: "SIP/2.0 480 Temporarily Unavailable",
        callId: fixture.callId(),
        cseq: "999 INVITE",
      }),
    );
    expect(busy).not.toHaveBeenCalled();

    const unavailable = signalingMessage({
      subject: "SIP/2.0 480 Temporarily Unavailable",
      callId: fixture.callId(),
      cseq: fixture.progressCseq(),
    });
    fixture.signaling.emit("message", unavailable);
    fixture.signaling.emit("message", unavailable);

    expect(busy).toHaveBeenCalledOnce();
    expect(disposed).toHaveBeenCalledOnce();
    expect(fixture.socket.close).toHaveBeenCalledOnce();
    expect(fixture.signaling.listenerCount("message")).toBe(1);
  });

  test("sends CANCEL from the real outbound session", async () => {
    const fixture = setupCall((cseq, callId) =>
      signalingMessage({
        subject: "SIP/2.0 183 Session Progress",
        callId,
        cseq,
        body: validSdp,
      }),
    );
    const session = await fixture.softphone.call("1002");

    await session.cancel();

    const cancel = fixture.signaling.send.mock.calls[0][0];
    expect(cancel.subject).toMatch(/^CANCEL /);
    expect(cancel.headers["Call-ID"]).toBe(fixture.callId());
    expect(cancel.headers.CSeq).toBe(
      fixture.progressCseq().replace(" INVITE", " CANCEL"),
    );
  });

  test("separates calls that share a response CSeq", async () => {
    const firstSocket = createSocket(4001);
    const secondSocket = createSocket(4002);
    vi.spyOn(dgram, "createSocket")
      .mockReturnValueOnce(firstSocket as unknown as dgram.Socket)
      .mockReturnValueOnce(secondSocket as unknown as dgram.Socket);
    const callIds: string[] = [];
    const request = vi.fn(async (message: OutboundMessage) => {
      if (request.mock.calls.length % 2 === 1) {
        return signalingMessage({
          subject: "SIP/2.0 407 Proxy Authentication Required",
          callId: message.headers["Call-ID"],
          cseq: message.headers.CSeq,
          headers: {
            "Proxy-Authenticate": 'Digest realm="example.com", nonce="nonce"',
          },
        });
      }
      callIds.push(message.headers["Call-ID"]);
      return signalingMessage({
        subject: "SIP/2.0 183 Session Progress",
        callId: message.headers["Call-ID"],
        cseq: "77 INVITE",
        body: validSdp,
      });
    });
    const signaling = createSignaling(request);
    const softphone = createSoftphone(signaling);
    const first = await softphone.call("1002");
    const second = await softphone.call("1003");
    const firstAnswered = vi.fn();
    const secondAnswered = vi.fn();
    first.on("answered", firstAnswered);
    second.on("answered", secondAnswered);

    signaling.emit(
      "message",
      signalingMessage({ callId: callIds[1], cseq: "77 INVITE" }),
    );
    expect(firstAnswered).not.toHaveBeenCalled();
    expect(secondAnswered).toHaveBeenCalledOnce();

    signaling.emit(
      "message",
      signalingMessage({ callId: callIds[0], cseq: "77 INVITE" }),
    );
    expect(firstAnswered).toHaveBeenCalledOnce();
  });
});
