import dgram from "node:dgram";
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
import {
  InboundMessage,
  type OutboundMessage,
  RequestMessage,
} from "../src/sip-message.js";
import { SipTransport } from "../src/sip-transport.js";
import type { InboundInvite } from "../src/types.js";
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

const createRemoteSrtpSession = (sdp: string) => {
  const localKey = sdp.match(/inline:([A-Za-z0-9+/]+)/)![1];
  const localKeyBuffer = Buffer.from(localKey, "base64");
  const remoteKeyBuffer = Buffer.from(remoteKey, "base64");
  return new SrtpSession(remoteKeyBuffer, localKeyBuffer);
};

const flush = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
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
  test.each([
    ["unchanged", sdp(), "127.0.0.1", 4000],
    ["IP only", sdp("192.0.2.20"), "192.0.2.20", 4000],
    ["port only", sdp("127.0.0.1", 5000), "127.0.0.1", 5000],
    ["IP and port", sdp("192.0.2.20", 5000), "192.0.2.20", 5000],
    [
      "optional codecs",
      `${sdp().replace("RTP/SAVP 0", "RTP/SAVP 8 0 101")}\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:101 telephone-event/8000`,
      "127.0.0.1",
      4000,
    ],
    [
      "semantic equivalent",
      `v=0\no=- 999 10 IN IP4 192.0.2.1\nc=IN IP4 127.0.0.1\na=sendrecv\nm=audio  4000 RTP/SAVP 0\na=rtpmap:0\tpcmu/8000/1\na=crypto:9  AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
      "127.0.0.1",
      4000,
    ],
  ] as const)(
    "handles a compatible %s re-INVITE internally",
    async (_name, body, ip, port) => {
      const fixture = await createAnsweredSession();
      fixture.request.mockResolvedValue(signalingMessage());
      await fixture.softphone.register();
      const incoming = vi.fn();
      fixture.softphone.on("invite", incoming);
      fixture.signaling.send.mockClear();
      const update = invite(body);
      update.headers.CSeq = "20 INVITE";
      update.headers.From = "<sip:1002@example.com>;tag=changed";
      update.headers.To = "<sip:1001@example.com>;tag=also-changed";

      fixture.signaling.emit("message", update);

      expect(incoming).not.toHaveBeenCalled();
      const responses = fixture.signaling.send.mock.calls.map(
        ([message]) => message,
      );
      expect(responses).toHaveLength(1);
      expect(responses[0].statusCode).toBe(200);
      expect(responses[0].body.trim().replaceAll("\r", "")).toBe(
        fixture.session.sdp.trim(),
      );
      expect(responses[0].getHeader("CSeq")).toBe("20 INVITE");
      fixture.session.sendDTMF("5");
      expect(fixture.socket.send).toHaveBeenLastCalledWith(
        expect.any(Buffer),
        port,
        ip,
      );
      expect(dgram.createSocket).toHaveBeenCalledOnce();
      expect(fixture.socket.close).not.toHaveBeenCalled();
      await fixture.session.hangup();
      const bye = fixture.signaling.send.mock.calls.at(-1)![0];
      expect(bye.getHeader("To")).toBe("<sip:1002@example.com>;tag=remote");
      expect(bye.getHeader("From")).toBe("<sip:1001@example.com>;tag=local");
      fixture.softphone.revoke();
    },
  );

  test.each([
    ["codec", sdp().replace("RTP/SAVP 0", "RTP/SAVP 8")],
    ["key", sdp().replace(remoteKey, Buffer.alloc(30, 2).toString("base64"))],
    ["cipher", sdp().replace("SHA1_80", "SHA1_32")],
    ["direction", `${sdp()}\r\na=sendonly`],
    ["offerless", ""],
    ["address", sdp("999.1.1.1")],
    ["zero port", sdp("127.0.0.1", 0)],
    ["oversized port", sdp("127.0.0.1", 65536)],
    ["transport", sdp().replace("RTP/SAVP", "RTP/AVP")],
    ["codec mapping", `${sdp()}\r\na=rtpmap:0 PCMA/8000`],
    ["tabbed codec mapping", `${sdp()}\r\na=rtpmap:0\tPCMA/8000`],
    ["empty codec mapping", `${sdp()}\r\na=rtpmap:0`],
    [
      "DTMF codec mapping",
      `${sdp().replace("RTP/SAVP 0", "RTP/SAVP 0 101")}\r\na=rtpmap:101 PCMA/8000`,
    ],
    [
      "DTMF clock mapping",
      `${sdp().replace("RTP/SAVP 0", "RTP/SAVP 0 101")}\r\na=rtpmap:101 telephone-event/16000`,
    ],
    ["empty DTMF mapping", `${sdp()}\r\na=rtpmap:101`],
    ["key options", `${sdp()}|2^20`],
    ["extra stream", `${sdp()}\r\nm=video 9000 RTP/SAVP 100`],
  ])(
    "rejects an incompatible %s update atomically and remains usable",
    async (_name, body) => {
      const fixture = await createAnsweredSession();
      fixture.request.mockResolvedValue(signalingMessage());
      await fixture.softphone.register();
      const incoming = vi.fn();
      fixture.softphone.on("invite", incoming);
      fixture.signaling.send.mockClear();
      const originalSdp = fixture.session.sdp;
      fixture.signaling.emit(
        "message",
        invite(body.replace("127.0.0.1", "192.0.2.30").replace("4000", "6000")),
      );
      expect(incoming).not.toHaveBeenCalled();
      expect(fixture.signaling.send).toHaveBeenCalledOnce();
      expect(fixture.signaling.send.mock.calls[0][0].statusCode).toBe(488);
      fixture.session.sendDTMF("5");
      expect(fixture.socket.send).toHaveBeenLastCalledWith(
        expect.any(Buffer),
        4000,
        "127.0.0.1",
      );
      expect(fixture.session.sdp).toBe(originalSdp);
      fixture.signaling.emit("message", invite(sdp("192.0.2.40", 7000)));
      expect(fixture.signaling.send.mock.calls[1][0].statusCode).toBe(200);
      fixture.session.sendDTMF("6");
      expect(fixture.socket.send).toHaveBeenLastCalledWith(
        expect.any(Buffer),
        7000,
        "192.0.2.40",
      );
      expect(fixture.socket.close).not.toHaveBeenCalled();
      await fixture.session.hangup();
      fixture.softphone.revoke();
    },
  );

  test.each([
    ["default", "", "", ""],
    ["session", "a=recvonly\r\n", "", "a=recvonly"],
    ["media override", "a=sendonly\r\n", "\r\na=recvonly", "a=recvonly"],
  ])(
    "uses effective startup settings with extra crypto alternatives (%s direction)",
    async (_name, sessionDirection, mediaDirection, updateDirection) => {
      const negotiated =
        sdp().replace("m=audio", `${sessionDirection}m=audio`) +
        `\r\na=crypto:2 AES_CM_128_HMAC_SHA1_32 inline:${remoteKey}${mediaDirection}`;
      const fixture = await createAnsweredSession({ inviteSdp: negotiated });
      fixture.request.mockResolvedValue(signalingMessage());
      await fixture.softphone.register();
      fixture.signaling.send.mockClear();
      const compatible = `${sdp("192.0.2.20", 5000)}\r\n${updateDirection}`;
      fixture.signaling.emit("message", invite(compatible));
      expect(fixture.signaling.send.mock.calls[0][0].statusCode).toBe(200);
      fixture.session.sendDTMF("5");
      expect(fixture.socket.send).toHaveBeenLastCalledWith(
        expect.any(Buffer),
        5000,
        "192.0.2.20",
      );
      fixture.signaling.emit(
        "message",
        invite(`${sdp("192.0.2.30", 6000)}\r\na=inactive`),
      );
      expect(fixture.signaling.send.mock.calls[1][0].statusCode).toBe(488);
      fixture.session.sendDTMF("6");
      expect(fixture.socket.send).toHaveBeenLastCalledWith(
        expect.any(Buffer),
        5000,
        "192.0.2.20",
      );
      const remote = createRemoteSrtpSession(fixture.session.sdp);
      const audio = vi.fn();
      fixture.session.on("audio", audio);
      fixture.socket.emit(
        "message",
        remote.encrypt(audioPacket.payload, audioPacket.header),
      );
      expect(audio).toHaveBeenCalledWith(audioPacket.payload);
      expect(dgram.createSocket).toHaveBeenCalledOnce();
      await fixture.session.hangup();
      fixture.softphone.revoke();
    },
  );

  test("uses ACK-negotiated key and direction for subsequent updates", async () => {
    const ackSdp = `${sdp().replace(remoteKey, Buffer.alloc(30, 2).toString("base64"))}\r\na=recvonly`;
    const fixture = await createAnsweredSession({ inviteSdp: "", ackSdp });
    fixture.request.mockResolvedValue(signalingMessage());
    await fixture.softphone.register();
    fixture.signaling.send.mockClear();
    fixture.signaling.emit("message", invite(ackSdp.replace("4000", "5000")));
    expect(fixture.signaling.send.mock.calls[0][0].statusCode).toBe(200);
    fixture.session.sendDTMF("5");
    expect(fixture.socket.send).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      5000,
      "127.0.0.1",
    );
    fixture.signaling.emit("message", invite(sdp()));
    expect(fixture.signaling.send.mock.calls[1][0].statusCode).toBe(488);
    await fixture.session.hangup();
    fixture.softphone.revoke();
  });

  test("compares offers with the SRTP key actually used at startup", async () => {
    const alternateKey = Buffer.alloc(30, 2).toString("base64");
    const negotiated = sdp()
      .replace(
        "m=audio",
        `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}\r\nm=audio`,
      )
      .replace(/inline:[^\r]+$/, `inline:${alternateKey}`);
    const fixture = await createAnsweredSession({ inviteSdp: negotiated });
    fixture.request.mockResolvedValue(signalingMessage());
    await fixture.softphone.register();
    fixture.signaling.send.mockClear();
    fixture.signaling.emit(
      "message",
      invite(sdp("192.0.2.20", 5000).replace(remoteKey, alternateKey)),
    );
    expect(fixture.signaling.send.mock.calls[0][0].statusCode).toBe(488);
    fixture.signaling.emit("message", invite(sdp("192.0.2.20", 5000)));
    expect(fixture.signaling.send.mock.calls[1][0].statusCode).toBe(200);
    const remote = createRemoteSrtpSession(fixture.session.sdp);
    const audio = vi.fn();
    fixture.session.on("audio", audio);
    fixture.socket.emit(
      "message",
      remote.encrypt(audioPacket.payload, audioPacket.header),
    );
    expect(audio).toHaveBeenCalledWith(audioPacket.payload);
    await fixture.session.hangup();
    fixture.softphone.revoke();
  });

  test("keeps encrypted media counters and local hold across an update", async () => {
    vi.useFakeTimers();
    const fixture = await createAnsweredSession();
    fixture.request.mockResolvedValue(signalingMessage());
    await fixture.softphone.register();
    const remote = createRemoteSrtpSession(fixture.session.sdp);
    fixture.socket.send.mockClear();
    fixture.session.streamAudio(Buffer.alloc(160));
    await vi.advanceTimersByTimeAsync(0);
    const before = remote.decrypt(fixture.socket.send.mock.calls[0][0]);
    expect(before?.payload).toEqual(Buffer.alloc(160));
    await fixture.session.hold();
    const heldSdp = fixture.session.sdp;
    expect(heldSdp).toContain("a=sendonly");
    fixture.signaling.send.mockClear();
    fixture.signaling.emit("message", invite(sdp("192.0.2.20", 5000)));
    expect(fixture.signaling.send.mock.calls[0][0].body).toContain(
      "a=sendonly",
    );
    expect(fixture.session.sdp).toBe(heldSdp);
    fixture.session.streamAudio(Buffer.alloc(160, 1));
    await vi.advanceTimersByTimeAsync(0);
    const after = remote.decrypt(fixture.socket.send.mock.calls[1][0]);
    expect(after?.payload).toEqual(Buffer.alloc(160, 1));
    expect(after?.header).toMatchObject({
      ssrc: before!.header.ssrc,
      sequenceNumber: (before!.header.sequenceNumber + 1) % 65536,
      timestamp: (before!.header.timestamp + 160) % 2 ** 32,
    });
    fixture.session.sendDTMF("5");
    const dtmf = remote.decrypt(fixture.socket.send.mock.calls[2][0]);
    expect(dtmf?.header).toMatchObject({
      ssrc: before!.header.ssrc,
      sequenceNumber: (before!.header.sequenceNumber + 2) % 65536,
      timestamp: (before!.header.timestamp + 320) % 2 ** 32,
      payloadType: 101,
    });
    expect(
      fixture.socket.send.mock.calls
        .slice(1)
        .every(([, port, ip]) => port === 5000 && ip === "192.0.2.20"),
    ).toBe(true);
    const received = vi.fn();
    fixture.session.on("audio", received);
    fixture.socket.emit(
      "message",
      remote.encrypt(Buffer.from("still encrypted"), audioPacket.header),
    );
    expect(received).toHaveBeenCalledWith(Buffer.from("still encrypted"));
    expect(dgram.createSocket).toHaveBeenCalledOnce();
    expect(fixture.socket.bind).toHaveBeenCalledOnce();
    await fixture.session.unhold();
    expect(fixture.session.sdp).toContain("a=sendrecv");
    await fixture.session.hangup();
    fixture.softphone.revoke();
  });

  test("routes established outbound calls separately and preserves unmatched incoming calls", async () => {
    const request = vi.fn(async (message: OutboundMessage) => {
      if (message.method === "REGISTER") return signalingMessage();
      if (message.method === "INVITE") {
        return signalingMessage({
          subject: message.getHeader("Proxy-Authorization")
            ? "SIP/2.0 183 Session Progress"
            : "SIP/2.0 407 Proxy Authentication Required",
          callId: message.callId,
          cseq: message.getHeader("CSeq"),
          body: sdp(),
          headers: {
            "Proxy-Authenticate": 'Digest realm="example.com", nonce="nonce"',
          },
        });
      }
      return signalingMessage({
        subject: "ACK sip:1001@example.com SIP/2.0",
        cseq: "1 ACK",
      });
    });
    const signaling = createSignaling(request);
    const softphone = createSoftphone(signaling);
    const firstSocket = createSocket(4321);
    const secondSocket = createSocket(4322);
    useSocket(firstSocket)
      .mockReturnValueOnce(firstSocket as unknown as dgram.Socket)
      .mockReturnValueOnce(secondSocket as unknown as dgram.Socket);
    await softphone.register();
    const outgoing = await softphone.call("1002");
    const answered = vi.fn();
    outgoing.on("answered", answered);
    const progress = request.mock.calls.at(-1)![0];
    signaling.emit(
      "message",
      signalingMessage({
        callId: outgoing.callId,
        cseq: progress.getHeader("CSeq"),
      }),
    );
    expect(answered).toHaveBeenCalledOnce();
    const inbound = await softphone.answer(
      invite(sdp(), "other-call") as unknown as InboundInvite,
    );
    const incoming = vi.fn();
    softphone.on("invite", incoming);
    signaling.send.mockClear();
    firstSocket.send.mockClear();
    secondSocket.send.mockClear();
    signaling.emit("message", invite(sdp("192.0.2.20", 5000), outgoing.callId));
    expect(signaling.send.mock.calls[0][0].statusCode).toBe(200);
    expect(incoming).not.toHaveBeenCalled();
    expect(answered).toHaveBeenCalledOnce();
    outgoing.sendDTMF("5");
    inbound.sendDTMF("6");
    expect(firstSocket.send).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      5000,
      "192.0.2.20",
    );
    expect(secondSocket.send).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      4000,
      "127.0.0.1",
    );
    const unmatched = invite(sdp(), "new-call");
    signaling.emit("message", unmatched);
    expect(incoming).toHaveBeenCalledExactlyOnceWith(unmatched);
    expect(signaling.send.mock.calls.at(-1)![0].statusCode).toBe(100);
    expect(dgram.createSocket).toHaveBeenCalledTimes(2);
    await outgoing.hangup();
    await inbound.hangup();
    softphone.revoke();
  });

  test("creates the shared SDP body", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const signaling = createSignaling();
    const softphone = createSoftphone(signaling, { codec: "OPUS/16000" });

    expect(softphone.createSdp(4000, remoteKey)).toBe(
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
        `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
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
    expect(fixture.softphone.listenerCount("message")).toBe(1);
    await fixture.session.hangup();
    await fixture.session.hangup();

    expect(fixture.signaling.send.mock.calls[0][0].subject).toMatch(/^BYE /);
    expect(disposed).toHaveBeenCalledOnce();
    expect(fixture.socket.close).toHaveBeenCalledOnce();
    expect(fixture.softphone.listenerCount("message")).toBe(0);
  });

  test("does not dispose when the local hangup request fails", async () => {
    const fixture = await createAnsweredSession();
    fixture.signaling.send.mockImplementationOnce(() => {
      throw new Error("send failed");
    });

    await expect(fixture.session.hangup()).rejects.toThrow("send failed");
    expect(fixture.session.media.disposed).toBe(false);
    expect(fixture.softphone.listenerCount("message")).toBe(1);
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
    const remoteSrtp = createRemoteSrtpSession(fixture.session.sdp);
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

  test("handles remote BYE from a replacement transport without stopping media", async () => {
    const request = vi.fn(async () =>
      request.mock.calls.length === 1
        ? signalingMessage({
            subject: "ACK sip:1001@example.com SIP/2.0",
            cseq: "1 ACK",
          })
        : signalingMessage(),
    );
    const fixture = await createAnsweredSession({ request });
    const replacement = createSignaling(vi.fn(async () => signalingMessage()));
    const disposed = vi.fn();
    fixture.session.on("disposed", disposed);
    fixture.softphone.on("signalingError", () => {});
    vi.mocked(SipTransport.connect).mockReturnValueOnce(replacement as never);
    await fixture.softphone.register();

    fixture.signaling.emit(
      "disconnected",
      Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
    );
    expect(fixture.session.media.disposed).toBe(false);
    await vi.waitFor(() =>
      expect(fixture.softphone.signaling).toBe(replacement),
    );
    expect(fixture.softphone.listenerCount("message")).toBe(2);

    replacement.emit(
      "message",
      signalingMessage({
        subject: "BYE sip:1001@example.com SIP/2.0",
        cseq: "2 BYE",
      }),
    );

    expect(disposed).toHaveBeenCalledOnce();
    expect(fixture.session.media.disposed).toBe(true);
    expect(fixture.softphone.listenerCount("message")).toBe(1);
  });

  test("disposes a pre-existing call after five minutes without recovery", async () => {
    vi.useFakeTimers();
    const fixture = await createAnsweredSession();
    const replacement = createSignaling();
    replacement.ready.mockImplementation(() => new Promise<void>(() => {}));
    vi.mocked(SipTransport.connect).mockReturnValueOnce(replacement as never);
    fixture.request.mockResolvedValue(signalingMessage());
    await fixture.softphone.register();

    fixture.signaling.emit("disconnected", new Error("disconnected"));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(fixture.session.media.disposed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.session.media.disposed).toBe(true);
    fixture.softphone.revoke();
  });

  test("disposes a call after reconciliation receives a non-2xx response", async () => {
    vi.useFakeTimers();
    const fixture = await createAnsweredSession();
    const replacement = createSignaling(
      vi
        .fn()
        .mockResolvedValueOnce(signalingMessage())
        .mockImplementationOnce(async (outbound: OutboundMessage) =>
          signalingMessage({
            subject: "SIP/2.0 503 Service Unavailable",
            callId: fixture.session.callId,
            cseq: outbound.headers.CSeq,
          }),
        ),
    );
    vi.mocked(SipTransport.connect).mockReturnValueOnce(replacement as never);
    fixture.request.mockResolvedValue(signalingMessage());
    await fixture.softphone.register();

    fixture.signaling.emit("disconnected", new Error("disconnected"));
    await flush();

    expect(fixture.session.media.disposed).toBe(true);
    expect(replacement.send).toHaveBeenCalledOnce();
    fixture.softphone.revoke();
  });

  test("gives reconciliation 32 seconds after registration succeeds", async () => {
    vi.useFakeTimers();
    const fixture = await createAnsweredSession();
    const replacement = createSignaling(
      vi
        .fn(async () => signalingMessage())
        .mockResolvedValueOnce(signalingMessage())
        .mockReturnValueOnce(new Promise<InboundMessage>(() => {})),
    );
    vi.mocked(SipTransport.connect).mockReturnValueOnce(replacement as never);
    fixture.request.mockResolvedValue(signalingMessage());
    await fixture.softphone.register();

    fixture.signaling.emit("disconnected", new Error("disconnected"));
    await flush();
    expect(replacement.request).toHaveBeenCalledTimes(2);
    const newSession = (await fixture.softphone.answer(
      invite(sdp(), "call-after-recovery") as unknown as InboundInvite,
    )) as InboundCallSession;
    expect(
      replacement.request.mock.calls.filter(([message]) =>
        message.subject.startsWith("INVITE "),
      ),
    ).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(31_999);
    expect(fixture.session.media.disposed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.session.media.disposed).toBe(true);
    expect(newSession.media.disposed).toBe(false);
    fixture.softphone.revoke();
  });

  test("reconciles affected calls independently with unchanged SDP", async () => {
    vi.useFakeTimers();
    const fixture = await createAnsweredSession();
    const secondSession = (await fixture.softphone.answer(
      invite(sdp(), "call-456") as unknown as InboundInvite,
    )) as InboundCallSession;
    fixture.request.mockResolvedValue(signalingMessage());
    await secondSession.hold();
    await fixture.softphone.register();
    const firstSdp = fixture.session.sdp;
    const secondSdp = secondSession.sdp;
    const replacement = createSignaling(
      vi.fn(async (outbound: OutboundMessage) => {
        if (outbound.subject.startsWith("REGISTER ")) {
          return signalingMessage();
        }
        if (outbound.callId === fixture.session.callId) {
          return new Promise<InboundMessage>(() => {});
        }
        return signalingMessage({
          callId: secondSession.callId,
          cseq: outbound.headers.CSeq,
        });
      }),
    );
    vi.mocked(SipTransport.connect).mockReturnValueOnce(replacement as never);

    fixture.signaling.emit("disconnected", new Error("disconnected"));
    await flush();

    const reInvites = replacement.request.mock.calls
      .map(([message]) => message)
      .filter((message) => message.subject.startsWith("INVITE "));
    expect(reInvites).toHaveLength(2);
    expect(
      reInvites.find((message) => message.callId === fixture.session.callId)
        ?.body,
    ).toBe(new RequestMessage("INVITE sip:test SIP/2.0", {}, firstSdp).body);
    expect(
      reInvites.find((message) => message.callId === secondSession.callId)
        ?.body,
    ).toBe(new RequestMessage("INVITE sip:test SIP/2.0", {}, secondSdp).body);
    expect(secondSession.media.disposed).toBe(false);

    await vi.advanceTimersByTimeAsync(32_000);
    expect(fixture.session.media.disposed).toBe(true);
    expect(secondSession.media.disposed).toBe(false);
    fixture.softphone.revoke();
  });

  test("ignores signaling for another call through the Softphone", async () => {
    const fixture = await createAnsweredSession();
    const disposed = vi.fn();
    fixture.session.on("disposed", disposed);

    fixture.softphone.emit(
      "message",
      signalingMessage({
        subject: "BYE sip:1001@example.com SIP/2.0",
        callId: "another-call",
        cseq: "2 BYE",
      }),
    );

    expect(disposed).not.toHaveBeenCalled();
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
    expect(fixture.session.sdp).toContain("a=sendonly");
    await fixture.session.unhold();
    expect(fixture.session.sdp).toContain("a=sendrecv");

    expect(request.mock.calls[1][0].body).toContain("a=sendonly");
    expect(request.mock.calls[2][0].body).toContain("a=sendrecv");
    expect(fixture.signaling.send).toHaveBeenCalledTimes(2);
    expect(fixture.signaling.send.mock.calls[0][0].subject).toMatch(/^ACK /);
    expect(fixture.signaling.send.mock.calls[1][0].subject).toMatch(/^ACK /);
    expect(fixture.signaling.send.mock.calls[0][0].getHeader("Via")).toMatch(
      /^SIP\/2\.0\/TLS 192\.0\.2\.1:5061;rport;branch=.+;alias$/,
    );
  });

  test("rejects a non-successful final response without changing SDP", async () => {
    const subject = "SIP/2.0 503 Service Unavailable";
    const request = vi.fn(async (outbound: OutboundMessage) => {
      if (request.mock.calls.length === 1) {
        return signalingMessage({
          subject: "ACK sip:1001@example.com SIP/2.0",
          cseq: "1 ACK",
        });
      }
      return signalingMessage({
        subject,
        cseq: outbound.headers.CSeq,
      });
    });
    const fixture = await createAnsweredSession({ request });
    const currentSdp = fixture.session.sdp;

    await expect(fixture.session.hold()).rejects.toThrow(
      `re-INVITE failed: ${subject}`,
    );

    expect(fixture.session.sdp).toBe(currentSdp);
    expect(fixture.signaling.send).toHaveBeenCalledOnce();
    expect(fixture.signaling.send.mock.calls[0][0].subject).toMatch(/^ACK /);
    expect(fixture.signaling.send.mock.calls[0][0].getHeader("Via")).toBe(
      "SIP/2.0/TLS client.example.com;branch=branch",
    );
  });

  test("leaves SDP unchanged when a re-INVITE request fails", async () => {
    const request = vi.fn(async () => {
      if (request.mock.calls.length === 1) {
        return signalingMessage({
          subject: "ACK sip:1001@example.com SIP/2.0",
          cseq: "1 ACK",
        });
      }
      throw new Error("transport failed");
    });
    const fixture = await createAnsweredSession({ request });
    const currentSdp = fixture.session.sdp;

    await expect(fixture.session.hold()).rejects.toThrow("transport failed");

    expect(fixture.session.sdp).toBe(currentSdp);
    expect(fixture.signaling.send).not.toHaveBeenCalled();
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
