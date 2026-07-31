import dgram from "node:dgram";
import EventEmitter from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";

import Softphone from "../src/index.js";
import { InboundMessage, type OutboundMessage } from "../src/sip-message.js";

const remoteKey = Buffer.alloc(30, 1).toString("base64");
const validSdp = [
  "v=0",
  "c=IN IP4 127.0.0.1",
  "m=audio 4000 RTP/SAVP 109",
  `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
].join("\r\n");

const response = (
  status: string,
  cseq: string,
  body = "",
  headers: Record<string, string> = {},
) =>
  new InboundMessage(
    `SIP/2.0 ${status}`,
    {
      "Call-ID": "call-123",
      From: "<sip:1001@example.com>;tag=local",
      To: "<sip:1002@example.com>;tag=remote",
      Via: "SIP/2.0/TLS client.example.com;branch=branch",
      CSeq: cseq,
      ...headers,
    },
    body,
  );

const setupCall = (progress: (cseq: string) => InboundMessage) => {
  const socket = Object.assign(new EventEmitter(), {
    bind: vi.fn(() => socket.emit("listening")),
    address: vi.fn(() => ({ port: 4000 })),
    send: vi.fn(),
    close: vi.fn(),
  });
  let progressCseq = "";
  const send = vi.fn(
    async (message: OutboundMessage): Promise<InboundMessage | undefined> => {
      if (send.mock.calls.length === 1) {
        return response(
          "407 Proxy Authentication Required",
          message.headers.CSeq,
          "",
          {
            "Proxy-Authenticate": 'Digest realm="example.com", nonce="nonce"',
          },
        );
      }
      if (send.mock.calls.length === 2) {
        progressCseq = message.headers.CSeq;
        return progress(progressCseq);
      }
    },
  );
  const softphone = Object.assign(new EventEmitter(), {
    call: Softphone.prototype.call,
    createSdp: Softphone.prototype.createSdp,
    client: { localAddress: "127.0.0.1", localPort: 5061 },
    codec: {
      id: 109,
      name: "OPUS/16000",
      packetSize: 640,
      timestampInterval: 320,
      createEncoder: () => ({ encode: (input: Buffer) => input }),
      createDecoder: () => ({ decode: (input: Buffer) => input }),
    },
    sipInfo: {
      domain: "example.com",
      outboundProxy: "proxy.example.com:5061",
      username: "1001",
      password: "secret",
      authorizationId: "1001",
    },
    send,
  }) as unknown as Softphone;

  vi.spyOn(dgram, "createSocket").mockReturnValue(
    socket as unknown as dgram.Socket,
  );

  return { softphone, socket, send, progressCseq: () => progressCseq };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("outbound call responses", () => {
  test("accepts 183 with SDP followed by 200", async () => {
    const fixture = setupCall((cseq) =>
      response("183 Session Progress", cseq, validSdp),
    );
    const session = await fixture.softphone.call("1002");
    const answered = vi.fn();
    session.on("answered", answered);
    expect(() => session.sendDTMF("1")).toThrow(
      "Media transport has not started",
    );
    expect(fixture.socket.send).not.toHaveBeenCalled();

    const ok = response("200 OK", fixture.progressCseq());
    fixture.softphone.emit("message", ok);
    fixture.softphone.emit("message", ok);

    expect(answered).toHaveBeenCalledOnce();
    expect(fixture.socket.send).toHaveBeenCalledWith(
      "hello",
      4000,
      "127.0.0.1",
    );
    const ack = fixture.send.mock.calls[2][0];
    expect(ack.subject).toMatch(/^ACK /);
    expect(ack.headers.CSeq).toBe(
      fixture.progressCseq().replace(" INVITE", " ACK"),
    );
  });

  test.each(["180 Ringing", "200 OK", "486 Busy Here"])(
    "rejects an initial %s response and closes the socket",
    async (status) => {
      const fixture = setupCall((cseq) => response(status, cseq));

      await expect(fixture.softphone.call("1002")).rejects.toThrow(
        `expected 183 Session Progress, received SIP/2.0 ${status}`,
      );
      expect(fixture.socket.close).toHaveBeenCalledOnce();
    },
  );

  test.each([
    validSdp.replace("c=IN IP4 127.0.0.1", ""),
    validSdp.replace("m=audio 4000 RTP/SAVP 109", ""),
    validSdp.replace(
      `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
      "",
    ),
  ])("rejects incomplete 183 SDP and closes the socket", async (sdp) => {
    const fixture = setupCall((cseq) =>
      response("183 Session Progress", cseq, sdp),
    );

    await expect(fixture.softphone.call("1002")).rejects.toThrow(
      "183 Session Progress did not contain usable SDP",
    );
    expect(fixture.socket.close).toHaveBeenCalledOnce();
  });

  test("closes bound media when SIP setup fails", async () => {
    const fixture = setupCall((cseq) =>
      response("183 Session Progress", cseq, validSdp),
    );
    fixture.send.mockRejectedValueOnce(new Error("send failed"));

    await expect(fixture.softphone.call("1002")).rejects.toThrow("send failed");
    expect(fixture.socket.close).toHaveBeenCalledOnce();
  });

  test("treats any matching non-200 response as busy", async () => {
    const fixture = setupCall((cseq) =>
      response("183 Session Progress", cseq, validSdp),
    );
    const session = await fixture.softphone.call("1002");
    const busy = vi.fn();
    const disposed = vi.fn();
    session.on("busy", busy);
    session.on("disposed", disposed);

    const request = response("480 ignored", fixture.progressCseq());
    request.subject = "INFO sip:1001@example.com SIP/2.0";
    fixture.softphone.emit("message", request);
    fixture.softphone.emit(
      "message",
      response("480 Temporarily Unavailable", "999 INVITE"),
    );
    expect(busy).not.toHaveBeenCalled();

    const unavailable = response(
      "480 Temporarily Unavailable",
      fixture.progressCseq(),
    );
    fixture.softphone.emit("message", unavailable);
    fixture.softphone.emit("message", unavailable);

    expect(busy).toHaveBeenCalledOnce();
    expect(disposed).toHaveBeenCalledOnce();
    expect(fixture.socket.close).toHaveBeenCalledOnce();
    expect(fixture.softphone.listenerCount("message")).toBe(0);
  });
});
