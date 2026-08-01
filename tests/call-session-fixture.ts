import dgram from "node:dgram";
import EventEmitter from "node:events";

import { vi } from "vitest";

import Softphone, { type SoftphoneOptions } from "../src/index.js";
import { InboundMessage } from "../src/sip-message.js";
import { SipTransport } from "../src/sip-transport.js";

export const options: SoftphoneOptions = {
  domain: "example.com",
  outboundProxy: "proxy.example.com:5061",
  username: "1001",
  password: "secret",
  authorizationId: "1001",
  codec: "PCMU/8000",
};

export const createSignaling = (request = vi.fn()) =>
  Object.assign(new EventEmitter(), {
    localAddress: "192.0.2.1",
    localPort: 5061,
    ready: vi.fn(async () => {}),
    request,
    send: vi.fn(),
    dispose: vi.fn(),
  });

export const createSoftphone = (
  signaling: ReturnType<typeof createSignaling>,
  overrides: Partial<SoftphoneOptions> = {},
) => {
  vi.spyOn(SipTransport, "connect").mockReturnValue(
    signaling as unknown as SipTransport,
  );
  return new Softphone({ ...options, ...overrides });
};

export const createSocket = (port = 4321) => {
  const socket = Object.assign(new EventEmitter(), {
    bind: vi.fn(() => socket.emit("listening")),
    address: vi.fn(() => ({ port })),
    send: vi.fn(),
    close: vi.fn(),
  });
  return socket;
};

export const useSocket = (socket: ReturnType<typeof createSocket>) =>
  vi
    .spyOn(dgram, "createSocket")
    .mockReturnValue(socket as unknown as dgram.Socket);

export const signalingMessage = ({
  subject = "SIP/2.0 200 OK",
  callId = "call-123",
  cseq = "1 INVITE",
  body = "",
  headers = {},
}: {
  subject?: string;
  callId?: string;
  cseq?: string;
  body?: string;
  headers?: Record<string, string>;
} = {}): InboundMessage => {
  return new InboundMessage(
    subject,
    {
      "Call-ID": callId,
      From: "<sip:1001@example.com>;tag=local",
      To: "<sip:1002@example.com>;tag=remote",
      Via: "SIP/2.0/TLS client.example.com;branch=branch",
      CSeq: cseq,
      ...headers,
    },
    body,
  );
};
