import dgram from "node:dgram";
import EventEmitter from "node:events";

import { afterEach, describe, expect, test, vi } from "vitest";
import { RtpHeader, RtpPacket, SrtpSession } from "werift-rtp";

vi.mock("node:timers/promises", () => ({
  setTimeout: (delay: number) =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, delay);
    }),
}));

import CallSession from "../src/call-session/index.js";
import { MediaTransport } from "../src/call-session/media.js";
import type Codec from "../src/codec.js";
import Softphone from "../src/index.js";
import { InboundMessage } from "../src/sip-message.js";
import type { InboundInvite } from "../src/types.js";
import { localKey } from "../src/utils.js";

const remoteKey = Buffer.alloc(30, 1).toString("base64");
const sdp = (ip = "127.0.0.1", port = 4000) =>
  [
    "v=0",
    `c=IN IP4 ${ip}`,
    `m=audio ${port} RTP/SAVP 0`,
    `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
  ].join("\r\n");

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

const testCodec = {
  id: 0,
  name: "PCMU/8000",
  packetSize: 160,
  timestampInterval: 160,
  createEncoder: () => ({ encode: (input: Buffer) => input }),
  createDecoder: () => ({ decode: (input: Buffer) => input }),
} as Codec;

class TestCallSession extends CallSession {
  public startMedia(body = sdp()) {
    this.startLocalServices(body);
  }
}

const message = (body = "") =>
  InboundMessage.fromString(
    [
      "SIP/2.0 200 OK",
      "Call-ID: call-123",
      "From: <sip:1001@example.com>;tag=local",
      "To: <sip:1002@example.com>;tag=remote",
      "CSeq: 1 INVITE",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "",
      body,
    ].join("\r\n"),
  );

const invite = (body: string) =>
  new InboundMessage(
    "INVITE sip:1001@example.com SIP/2.0",
    {
      "Call-ID": "call-123",
      From: "<sip:1002@example.com>;tag=remote",
      To: "<sip:1001@example.com>;tag=local",
      Via: "SIP/2.0/TLS remote.example.com;branch=branch",
      CSeq: "1 INVITE",
    },
    body,
  );

const socket = () => {
  const udpSocket = Object.assign(new EventEmitter(), {
    bind: vi.fn(() => udpSocket.emit("listening")),
    address: vi.fn(() => ({ port: 4321 })),
    send: vi.fn(),
    close: vi.fn(),
  });
  return udpSocket;
};

const softphone = (send: ReturnType<typeof vi.fn>) =>
  Object.assign(new EventEmitter(), {
    sipInfo: { domain: "example.com", username: "1001" },
    fakeDomain: "client.invalid",
    codec: testCodec,
    signaling: {
      localAddress: "192.0.2.1",
      localPort: 5061,
      request: send,
      send,
    },
    createSdp: Softphone.prototype.createSdp,
  }) as unknown as Softphone;

const bindMedia = async (phone: Softphone, udpSocket = socket()) => {
  vi.spyOn(dgram, "createSocket").mockReturnValue(
    udpSocket as unknown as dgram.Socket,
  );
  return {
    media: await MediaTransport.bind(phone.codec),
    udpSocket,
  };
};

const createSession = async (send: ReturnType<typeof vi.fn>) => {
  const phone = softphone(send);
  const bound = await bindMedia(phone);
  const session = new TestCallSession(phone, message(), bound.media);
  session.localPeer = "<sip:1001@example.com>;tag=local";
  session.remotePeer = "<sip:1002@example.com>;tag=remote";
  return { phone, session, ...bound };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CallSession lifecycle", () => {
  test("creates the shared SDP body", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const phone = {
      signaling: { localAddress: "192.0.2.1" },
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

  test("disposes media before emitting disposed", async () => {
    const fixture = await createSession(vi.fn());
    const removeAllListeners = vi.spyOn(
      fixture.udpSocket,
      "removeAllListeners",
    );
    const disposed = vi.fn(() => {
      expect(fixture.session.media.disposed).toBe(true);
      expect(fixture.udpSocket.close).toHaveBeenCalledOnce();
    });
    fixture.session.on("disposed", disposed);

    expect(fixture.session).toBeInstanceOf(EventEmitter);
    await fixture.session.hangup();
    await fixture.session.hangup();

    expect(disposed).toHaveBeenCalledOnce();
    expect(removeAllListeners).toHaveBeenCalledOnce();
    expect(fixture.udpSocket.close).toHaveBeenCalledOnce();
  });

  test("does not dispose when the local hangup request fails", async () => {
    const fixture = await createSession(
      vi.fn(() => {
        throw new Error("send failed");
      }),
    );

    await expect(fixture.session.hangup()).rejects.toThrow("send failed");
    expect(fixture.session.media.disposed).toBe(false);
  });

  test("keeps the delay after each DTMF character", async () => {
    vi.useFakeTimers();
    const fixture = await createSession(vi.fn());
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

  test("forwards media events through the call session", async () => {
    const fixture = await createSession(vi.fn());
    const remoteSrtp = createRemoteSrtpSession();
    const raw = vi.fn();
    const audio = vi.fn();
    fixture.session.on("rtpPacket", raw);
    fixture.session.on("audio", audio);

    fixture.session.startMedia();
    const packet = new RtpPacket(
      new RtpHeader({ payloadType: 0 }),
      Buffer.from("audio"),
    );
    fixture.udpSocket.emit(
      "message",
      remoteSrtp.encrypt(packet.payload, packet.header),
    );

    expect(raw).toHaveBeenCalledOnce();
    expect(audio).toHaveBeenCalledWith(Buffer.from("audio"));
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
    const udpSocket = socket();
    vi.spyOn(dgram, "createSocket").mockReturnValue(
      udpSocket as unknown as dgram.Socket,
    );
    const ack = message(ackSdp);
    const phone = softphone(vi.fn(async () => ack));

    await Softphone.prototype.answer.call(
      phone,
      invite(inviteSdp) as unknown as InboundInvite,
    );

    expect(udpSocket.send).toHaveBeenCalledWith(
      "hello",
      expectedPort,
      expectedIP,
    );
  });

  test("closes bound media when inbound setup fails", async () => {
    const udpSocket = socket();
    vi.spyOn(dgram, "createSocket").mockReturnValue(
      udpSocket as unknown as dgram.Socket,
    );
    const phone = softphone(vi.fn(async () => message()));

    await expect(
      Softphone.prototype.answer.call(
        phone,
        invite("") as unknown as InboundInvite,
      ),
    ).rejects.toThrow("negotiated SDP did not contain");
    expect(udpSocket.close).toHaveBeenCalledOnce();
  });
});
