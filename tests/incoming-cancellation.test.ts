import dgram from "node:dgram";
import { afterEach, expect, test, vi } from "vitest";
import { InboundMessage, type OutboundMessage } from "../src/sip-message.js";
import type { InboundInvite } from "../src/types.js";
import {
  createSignaling,
  createSocket,
  createSoftphone,
  signalingMessage,
  useSocket,
} from "./call-session-fixture.js";

const invitation = (callId = "incoming") =>
  InboundMessage.fromString(
    [
      "INVITE sip:1001@example.com SIP/2.0",
      `Call-ID: ${callId}`,
      "From: <sip:1002@example.com>;tag=remote",
      "To: <sip:1001@example.com>",
      "Via: SIP/2.0/TLS remote.example.com;branch=z9hG4bK-original",
      "CSeq: 42 INVITE",
      "",
      "",
    ].join("\r\n"),
  );
const cancellation = (invite: InboundMessage) =>
  InboundMessage.fromString(
    [
      "CANCEL sip:1001@example.com SIP/2.0",
      ...Object.entries(invite.headers).map(
        ([name, value]) =>
          `${name}: ${name === "CSeq" ? "42 CANCEL" : name === "To" ? "<sip:1001@example.com>" : value}`,
      ),
      "",
      "",
    ].join("\r\n"),
  );
const phone = async () => {
  const signaling = createSignaling(
    vi.fn(async (_message: OutboundMessage) => signalingMessage()),
  );
  const softphone = createSoftphone(signaling);
  await softphone.register();
  return { softphone, signaling };
};
afterEach(() => {
  vi.restoreAllMocks();
});

test("cancellation replies precede the original invitation's cancellation event and obsolete actions reject", async () => {
  useSocket(createSocket());
  const { softphone, signaling } = await phone();
  const invite = invitation();
  const incoming = vi.fn();
  softphone.on("invite", incoming);
  signaling.emit("message", invite);
  signaling.send.mockClear();
  const cancel = cancellation(invite);
  const canceled = vi.fn((original: InboundInvite) => {
    expect(original).toBe(invite);
    expect(
      signaling.send.mock.calls.map(([message]) => message.subject),
    ).toEqual(["SIP/2.0 200 OK", "SIP/2.0 487 Request Terminated"]);
    softphone.revoke();
  });
  softphone.on("inviteCanceled", canceled);
  signaling.emit("message", cancel);
  expect(incoming).toHaveBeenCalledExactlyOnceWith(invite);
  expect(canceled).toHaveBeenCalledOnce();
  for (const [reply] of signaling.send.mock.calls) {
    expect(reply.getHeader("To")).toBe(invite.getHeader("To"));
    expect(reply.callId).toBe("incoming");
    expect(reply.getHeader("Via")).toBe(invite.getHeader("Via"));
    expect(reply.getHeader("From")).toBe(invite.getHeader("From"));
  }
  expect(
    signaling.send.mock.calls.map(([reply]) => reply.getHeader("CSeq")),
  ).toEqual(["42 CANCEL", "42 INVITE"]);
  await expect(
    softphone.answer(invite as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  await expect(
    softphone.decline(invite as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  expect(signaling.send).toHaveBeenCalledTimes(2);
  expect(dgram.createSocket).not.toHaveBeenCalled();
});

test("cancellation during media binding releases the allocation without answering", async () => {
  const { softphone, signaling } = await phone();
  const socket = createSocket();
  socket.bind.mockImplementation(() => true);
  useSocket(socket);
  const invite = invitation();
  signaling.emit("message", invite);
  const answering = softphone.answer(invite as unknown as InboundInvite);
  const rejected = expect(answering).rejects.toThrow("pending");
  signaling.send.mockClear();
  signaling.emit("message", cancellation(invite));
  socket.emit("listening");
  await rejected;
  expect(socket.close).toHaveBeenCalledOnce();
  expect(signaling.request).toHaveBeenCalledTimes(1);
  expect(signaling.send.mock.calls.map(([reply]) => reply.statusCode)).toEqual([
    200, 487,
  ]);
  softphone.revoke();
});

test("wrong transactions and another invitation do not cancel a pending invitation", async () => {
  const { softphone, signaling } = await phone();
  const first = invitation();
  const second = invitation("another");
  const canceled = vi.fn();
  softphone.on("inviteCanceled", canceled);
  signaling.emit("message", first);
  signaling.emit("message", second);
  signaling.send.mockClear();
  for (const headers of [
    { CSeq: "43 CANCEL" },
    { Via: "SIP/2.0/TLS remote.example.com;branch=other" },
    { From: "<sip:other@example.com>;tag=remote" },
    { "Call-ID": "missing" },
  ]) {
    const cancel = cancellation(first);
    Object.assign(cancel.headers, headers);
    signaling.emit("message", cancel);
    expect(signaling.send.mock.calls.at(-1)![0].statusCode).toBe(481);
  }
  expect(canceled).not.toHaveBeenCalled();
  signaling.emit("message", cancellation(first));
  expect(canceled).toHaveBeenCalledExactlyOnceWith(first);
  await softphone.decline(second as unknown as InboundInvite);
  expect(signaling.send.mock.calls.at(-1)![0].statusCode).toBe(603);
  await expect(
    softphone.decline(second as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  expect(canceled).toHaveBeenCalledOnce();
  softphone.revoke();
});

test("foreign invitations and teardown leave no answerable invitations", async () => {
  const first = await phone();
  const second = await phone();
  const invite = invitation();
  first.signaling.emit("message", invite);
  await expect(
    second.softphone.answer(invite as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  await expect(
    second.softphone.decline(invite as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  expect(second.signaling.send).not.toHaveBeenCalled();
  first.softphone.revoke();
  await expect(
    first.softphone.answer(invite as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  await expect(
    first.softphone.decline(invite as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  second.softphone.revoke();
});

test.each([0, 1])(
  "reply send failure %s still cancels and releases media",
  async (failureIndex) => {
    const { softphone, signaling } = await phone();
    const socket = createSocket();
    socket.bind.mockImplementation(() => true);
    useSocket(socket);
    const invite = invitation();
    signaling.emit("message", invite);
    const answering = softphone.answer(invite as unknown as InboundInvite);
    const rejected = expect(answering).rejects.toThrow("pending");
    const failure = new Error("send failed");
    const errors = vi.fn();
    const canceled = vi.fn();
    softphone.on("signalingError", errors);
    softphone.on("inviteCanceled", canceled);
    signaling.send.mockClear();
    let index = 0;
    signaling.send.mockImplementation(() => {
      if (index++ === failureIndex) throw failure;
    });
    signaling.emit("message", cancellation(invite));
    expect(signaling.send).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledExactlyOnceWith(failure);
    expect(canceled).toHaveBeenCalledExactlyOnceWith(invite);
    socket.emit("listening");
    await rejected;
    expect(socket.close).toHaveBeenCalledOnce();
    softphone.revoke();
  },
);

test("CANCEL after a final answer leaves the call intact and consumed invitations reject", async () => {
  const { softphone, signaling } = await phone();
  const socket = createSocket();
  useSocket(socket);
  const invite = invitation();
  invite.body = `v=0\r\nc=IN IP4 127.0.0.1\r\nm=audio 4000 RTP/SAVP 0\r\na=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${Buffer.alloc(30, 1).toString("base64")}\r\n`;
  signaling.request.mockResolvedValueOnce(
    signalingMessage({
      subject: "ACK sip:1001@example.com SIP/2.0",
      cseq: "42 ACK",
    }),
  );
  signaling.emit("message", invite);
  const session = await softphone.answer(invite as unknown as InboundInvite);
  const disposed = vi.fn();
  const canceled = vi.fn();
  session.on("disposed", disposed);
  softphone.on("inviteCanceled", canceled);
  signaling.send.mockClear();
  signaling.emit("message", cancellation(invite));
  expect(signaling.send.mock.calls[0][0].statusCode).toBe(481);
  expect(disposed).not.toHaveBeenCalled();
  expect(canceled).not.toHaveBeenCalled();
  expect(socket.close).not.toHaveBeenCalled();
  await expect(
    softphone.answer(invite as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  await session.hangup();
  softphone.revoke();
});

test("teardown while answering releases media and concurrent invitation actions reject", async () => {
  const { softphone, signaling } = await phone();
  const socket = createSocket();
  socket.bind.mockImplementation(() => true);
  useSocket(socket);
  const invite = invitation();
  signaling.emit("message", invite);
  const answering = softphone.answer(invite as unknown as InboundInvite);
  const rejected = expect(answering).rejects.toThrow("pending");
  await expect(
    softphone.answer(invite as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  await expect(
    softphone.decline(invite as unknown as InboundInvite),
  ).rejects.toThrow("pending");
  softphone.revoke();
  socket.emit("listening");
  await rejected;
  expect(socket.close).toHaveBeenCalledOnce();
  expect(signaling.request).toHaveBeenCalledTimes(1);
});
