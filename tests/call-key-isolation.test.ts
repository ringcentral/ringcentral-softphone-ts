import dgram from "node:dgram";
import { once } from "node:events";

import { afterEach, expect, test, vi } from "vitest";

import * as DTMF from "../src/dtmf.js";
import { SrtpSession } from "../src/rtp/index.js";
import type { OutboundMessage } from "../src/sip-message.js";
import { SipTransport } from "../src/sip-transport.js";
import type { CallSession, InboundInvite } from "../src/types.js";
import {
  createSignaling,
  createSocket,
  createSoftphone,
  signalingMessage,
  useSocket,
} from "./call-session-fixture.js";

const remoteKey = Buffer.alloc(30, 1).toString("base64");
const remoteSdp = (port = 4000) =>
  [
    "v=0",
    "c=IN IP4 127.0.0.1",
    `m=audio ${port} RTP/SAVP 0`,
    `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${remoteKey}`,
  ].join("\r\n");

const advertisedKey = (sdp: string) => {
  const key = sdp.match(/AES_CM_128_HMAC_SHA1_80 inline:([A-Za-z0-9+/]+)/)![1];
  expect(Buffer.from(key, "base64")).toHaveLength(30);
  return key;
};

const createPhone = () => {
  const request = vi.fn(async (message: OutboundMessage) => {
    const reply = { callId: message.callId, cseq: message.getHeader("CSeq") };
    if (message.getHeader("Route")) {
      return message.getHeader("Proxy-Authorization")
        ? signalingMessage({
            ...reply,
            subject: "SIP/2.0 183 Session Progress",
            body: remoteSdp(),
          })
        : signalingMessage({
            ...reply,
            subject: "SIP/2.0 407 Proxy Authentication Required",
            headers: {
              "Proxy-Authenticate": 'Digest realm="example.com", nonce="nonce"',
            },
          });
    }
    return signalingMessage({
      ...reply,
      subject:
        message.statusCode === 200
          ? "ACK sip:1001@example.com SIP/2.0"
          : "SIP/2.0 200 OK",
    });
  });
  const signaling = createSignaling(request);
  const softphone = createSoftphone(signaling);
  let callNumber = 0;
  const start = async (direction: "inbound" | "outbound") => {
    const socket = createSocket();
    useSocket(socket);
    let session: CallSession;
    if (direction === "inbound") {
      session = await softphone.answer(
        signalingMessage({
          subject: "INVITE sip:1001@example.com SIP/2.0",
          callId: `inbound-${++callNumber}`,
          body: remoteSdp(),
        }) as unknown as InboundInvite,
      );
    } else {
      session = await softphone.call("1002");
      const invite = request.mock.calls.at(-1)![0];
      signaling.emit(
        "message",
        signalingMessage({
          callId: invite.callId,
          cseq: invite.getHeader("CSeq"),
        }),
      );
    }
    const localSdp = request.mock.calls.at(-1)![0].body;
    return { session, socket, key: advertisedKey(localSdp) };
  };
  return { softphone, signaling, request, start };
};

afterEach(() => {
  vi.restoreAllMocks();
});

type TestCall = Awaited<ReturnType<ReturnType<typeof createPhone>["start"]>>;

const peerFor = (key: string) =>
  new SrtpSession(Buffer.from(remoteKey, "base64"), Buffer.from(key, "base64"));

const sendMedia = async (call: TestCall) => {
  call.socket.send.mockClear();
  await once(call.session.streamAudio(Buffer.alloc(160, 0x7f)), "finished");
  call.session.sendDTMF("5");
  return call.socket.send.mock.calls.map(([packet]) => packet as Buffer);
};

const expectMedia = (packets: Buffer[], peer: SrtpSession) => {
  const audio = peer.decrypt(packets[0]);
  expect(audio?.payload).toEqual(Buffer.alloc(160, 0x7f));
  expect(audio?.header.payloadType).toBe(0);
  for (const [index, payload] of DTMF.charToPayloads("5").entries()) {
    const packet = peer.decrypt(packets[index + 1]);
    expect(packet?.payload).toEqual(payload);
    expect(packet?.header.payloadType).toBe(101);
  }
  expect(packets).toHaveLength(7);
  return audio!.header;
};

test.each([
  ["inbound", "inbound"],
  ["outbound", "outbound"],
  ["inbound", "outbound"],
  ["outbound", "inbound"],
] as const)(
  "isolates concurrent and sequential %s/%s calls",
  async (firstDirection, secondDirection) => {
    const phone = createPhone();
    const first = await phone.start(firstDirection);
    const firstPackets = await sendMedia(first);
    const concurrent = await phone.start(secondDirection);
    const concurrentPackets = await sendMedia(concurrent);
    await first.session.hangup();
    await concurrent.session.hangup();
    const sequential = await phone.start(firstDirection);
    const sequentialPackets = await sendMedia(sequential);
    try {
      const calls = [first, concurrent, sequential];
      const captures = [firstPackets, concurrentPackets, sequentialPackets];
      expect(new Set(calls.map((call) => call.key)).size).toBe(3);
      for (const [index, call] of calls.entries()) {
        expectMedia(captures[index], peerFor(call.key));
        const wrongPeer = peerFor(calls[(index + 1) % calls.length].key);
        for (const packet of captures[index])
          expect(wrongPeer.decrypt(packet)).toBeUndefined();
      }
    } finally {
      await sequential.session.hangup();
      phone.softphone.revoke();
    }
  },
);

test("isolates media between Softphone instances with the same credentials", async () => {
  const firstPhone = createPhone();
  const secondPhone = createPhone();
  const first = await firstPhone.start("inbound");
  const second = await secondPhone.start("outbound");
  try {
    expect(new Set([first.key, second.key]).size).toBe(2);
    for (const [call, other] of [
      [first, second],
      [second, first],
    ]) {
      const packets = await sendMedia(call);
      expectMedia(packets, peerFor(call.key));
      const wrongPeer = peerFor(other.key);
      for (const packet of packets)
        expect(wrongPeer.decrypt(packet)).toBeUndefined();
    }
  } finally {
    await first.session.hangup();
    await second.session.hangup();
    firstPhone.softphone.revoke();
    secondPhone.softphone.revoke();
  }
});

test.each(["inbound", "outbound"] as const)(
  "retains %s encryption and packet state through hold, destination update and signaling recovery",
  async (direction) => {
    const phone = createPhone();
    await phone.softphone.register();
    const call = await phone.start(direction);
    const peer = peerFor(call.key);
    const received = vi.fn();
    call.session.on("audio", received);
    const incoming = peer.encrypt(Buffer.from("remote audio"), {
      marker: false,
      payloadType: 0,
      sequenceNumber: 42,
      timestamp: 0,
      ssrc: 1234,
    });
    call.socket.emit("message", incoming);
    expect(received).toHaveBeenCalledOnce();
    let previous = expectMedia(await sendMedia(call), peer);
    try {
      for (const held of [true, false]) {
        if (held) await call.session.hold();
        else await call.session.unhold();
        const offer = phone.request.mock.calls.at(-1)![0];
        expect(offer.body).toContain(held ? "a=sendonly" : "a=sendrecv");
        expect(advertisedKey(offer.body)).toBe(call.key);
        const afterHold = expectMedia(await sendMedia(call), peer);
        expect(afterHold).toMatchObject({
          ssrc: previous.ssrc,
          sequenceNumber: (previous.sequenceNumber + 7) % 65536,
          timestamp: (previous.timestamp + 960) % 2 ** 32,
        });
        previous = afterHold;
      }
      const unhold = phone.request.mock.calls.at(-1)![0];

      const update = signalingMessage({
        subject: "INVITE sip:1001@example.com SIP/2.0",
        callId: call.session.callId,
        cseq: "99 INVITE",
        body: remoteSdp(5000).replace("127.0.0.1", "192.0.2.20"),
      });
      phone.signaling.emit("message", update);
      const answer = phone.signaling.send.mock.calls.at(-1)![0];
      expect(answer.statusCode).toBe(200);
      expect(advertisedKey(answer.body)).toBe(call.key);
      const afterUpdate = expectMedia(await sendMedia(call), peer);
      expect(afterUpdate).toMatchObject({
        ssrc: previous.ssrc,
        sequenceNumber: (previous.sequenceNumber + 7) % 65536,
        timestamp: (previous.timestamp + 960) % 2 ** 32,
      });
      previous = afterUpdate;
      expect(
        call.socket.send.mock.calls.every(
          ([, port, ip]) => port === 5000 && ip === "192.0.2.20",
        ),
      ).toBe(true);

      const replacement = createSignaling(phone.request);
      vi.mocked(SipTransport.connect).mockReturnValueOnce(replacement as never);
      phone.softphone.on("signalingError", () => {});
      phone.signaling.emit("disconnected", new Error("connection lost"));
      await vi.waitFor(() => {
        expect(phone.softphone.signaling).toBe(replacement);
        expect(replacement.send).toHaveBeenCalled();
      });
      const reconcile = phone.request.mock.calls.at(-1)![0];
      expect(reconcile.method).toBe("INVITE");
      expect(advertisedKey(reconcile.body)).toBe(call.key);
      expect(reconcile.body).toBe(unhold.body);
      const afterRecovery = expectMedia(await sendMedia(call), peer);
      expect(afterRecovery).toMatchObject({
        ssrc: previous.ssrc,
        sequenceNumber: (previous.sequenceNumber + 7) % 65536,
        timestamp: (previous.timestamp + 960) % 2 ** 32,
      });
      call.socket.emit("message", incoming);
      expect(received).toHaveBeenCalledOnce();
      expect(dgram.createSocket).toHaveBeenCalledOnce();
      expect(call.socket.close).not.toHaveBeenCalled();
    } finally {
      await call.session.hangup();
      phone.softphone.revoke();
    }
  },
);
