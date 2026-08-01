import EventEmitter from "node:events";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("node:tls", () => ({
  default: { connect },
  connect,
}));

import { RequestMessage } from "../src/sip-message.js";
import { SipTransport } from "../src/sip-transport.js";

const createSocket = () =>
  Object.assign(new EventEmitter(), {
    localAddress: "192.0.2.1",
    localPort: 5061,
    write: vi.fn(() => true),
    destroy: vi.fn(),
  });

const options = {
  outboundProxy: "proxy.example.com:5096",
  ignoreTlsCertErrors: false,
};

const outbound = (callId = "call-a", cseq = "1 INVITE") =>
  new RequestMessage("INVITE sip:1002@example.com SIP/2.0", {
    "Call-ID": callId,
    CSeq: cseq,
  });

const frame = ({
  subject = "SIP/2.0 200 OK",
  callId = "call-a",
  cseq = "1 INVITE",
  body = "",
  lengths = [`Content-Length: ${Buffer.byteLength(body)}`],
}: {
  subject?: string;
  callId?: string;
  cseq?: string;
  body?: string;
  lengths?: string[];
} = {}) =>
  Buffer.from(
    [
      subject,
      `Call-ID: ${callId}`,
      `CSeq: ${cseq}`,
      "To: <sip:1002@example.com>;tag=remote",
      ...lengths,
      "",
      body,
    ].join("\r\n"),
  );

let socket: ReturnType<typeof createSocket>;

beforeEach(() => {
  socket = createSocket();
  connect.mockReset();
  connect.mockReturnValue(socket);
});

const createTransport = () => SipTransport.connect(options);
const createReadyTransport = () => {
  const transport = createTransport();
  socket.emit("secureConnect");
  return transport;
};

describe("SIP transport lifecycle", () => {
  test("connects, waits for TLS, and exposes the local endpoint", async () => {
    const transport = createTransport();
    const ready = transport.ready(new AbortController().signal);

    expect(connect).toHaveBeenCalledWith({
      host: "proxy.example.com",
      port: 5096,
      rejectUnauthorized: true,
    });
    socket.emit("secureConnect");

    await ready;
    await transport.ready(new AbortController().signal);
    expect(transport.localAddress).toBe("192.0.2.1");
    expect(transport.localPort).toBe(5061);
  });

  test("aborts only the readiness wait", async () => {
    const transport = createTransport();
    const controller = new AbortController();
    const ready = transport.ready(controller.signal);

    controller.abort();
    await expect(ready).rejects.toBe(controller.signal.reason);

    socket.emit("secureConnect");
    await expect(
      transport.ready(new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  test("rejects signaling before TLS is ready", async () => {
    const transport = createTransport();

    expect(() => transport.send(outbound())).toThrow(
      "SIP transport is not ready",
    );
    await expect(transport.request(outbound())).rejects.toThrow(
      "SIP transport is not ready",
    );
    expect(socket.write).not.toHaveBeenCalled();
  });

  test("propagates TLS errors and cleans up its listeners", async () => {
    const transport = createTransport();
    const ready = transport.ready(new AbortController().signal);
    const error = new Error("TLS failed");

    socket.emit("error", error);

    await expect(ready).rejects.toBe(error);
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(socket.eventNames()).toEqual([]);
    expect(transport.eventNames()).toEqual([]);
  });
});

describe("SIP stream framing", () => {
  test("reads fragmented and coalesced messages by body byte length", () => {
    const transport = createReadyTransport();
    const received = vi.fn();
    transport.on("message", received);

    const body = "first\r\n\r\n世界";
    const first = frame({
      body,
      lengths: [`cOnTeNt-LeNgTh: ${Buffer.byteLength(body)}`],
    });
    const second = frame({
      subject: "SIP/2.0 183 Session Progress",
      callId: "call-b",
      cseq: "2 INVITE",
      lengths: ["l: 0"],
    });

    socket.emit(
      "data",
      Buffer.concat([Buffer.from("\r\n"), first.subarray(0, 10)]),
    );
    socket.emit("data", first.subarray(10, -1));
    expect(received).not.toHaveBeenCalled();

    socket.emit("data", Buffer.concat([first.subarray(-1), second]));

    expect(received).toHaveBeenCalledTimes(2);
    expect(received.mock.calls[0][0].body).toBe(body);
    expect(received.mock.calls[1][0].subject).toBe(
      "SIP/2.0 183 Session Progress",
    );
  });

  test.each([
    {
      name: "missing",
      lengths: [],
      message: "missing Content-Length",
    },
    {
      name: "nonnumeric",
      lengths: ["Content-Length: nope"],
      message: "invalid Content-Length",
    },
    {
      name: "negative",
      lengths: ["Content-Length: -1"],
      message: "invalid Content-Length",
    },
    {
      name: "unsafe",
      lengths: ["Content-Length: 99999999999999999999"],
      message: "invalid Content-Length",
    },
    {
      name: "conflicting",
      lengths: ["Content-Length: 0", "l: 1"],
      message: "conflicting Content-Length",
    },
  ])(
    "fails the transport for a $name body length",
    async ({ lengths, message }) => {
      const transport = createReadyTransport();
      const pending = transport.request(outbound());

      socket.emit("data", frame({ lengths }));

      await expect(pending).rejects.toThrow(message);
      expect(socket.destroy).toHaveBeenCalledOnce();
      expect(socket.eventNames()).toEqual([]);
      expect(transport.eventNames()).toEqual([]);
    },
  );
});

describe("SIP transactions", () => {
  test("matches exact Call-ID and numeric CSeq while emitting every message", async () => {
    const transport = createReadyTransport();
    const received = vi.fn();
    transport.on("message", received);
    let firstSettled = false;

    const first = transport.request(outbound("Call-A", "7 INVITE"));
    void first.then(() => {
      firstSettled = true;
    });
    const second = transport.request(outbound("Call-B", "8 INVITE"));

    socket.emit(
      "data",
      frame({
        subject: "SIP/2.0 100 Trying",
        callId: "Call-A",
        cseq: "7 INVITE",
      }),
    );
    socket.emit("data", frame({ callId: "call-a", cseq: "7 INVITE" }));
    await Promise.resolve();
    expect(firstSettled).toBe(false);

    socket.emit("data", frame({ callId: "Call-B", cseq: "8 INVITE" }));
    await expect(second).resolves.toMatchObject({
      headers: { CSeq: "8 INVITE" },
    });

    socket.emit(
      "data",
      frame({
        subject: "ACK sip:1001@example.com SIP/2.0",
        callId: "Call-A",
        cseq: "7 ACK",
      }),
    );
    await expect(first).resolves.toMatchObject({
      subject: "ACK sip:1001@example.com SIP/2.0",
    });
    expect(received).toHaveBeenCalledTimes(4);
  });

  test("registers a request before writing and observes outbound data first", async () => {
    const transport = createReadyTransport();
    const order: string[] = [];
    transport.on("outboundMessage", () => order.push("event"));
    socket.write.mockImplementationOnce(() => {
      order.push("write");
      socket.emit("data", frame());
      return true;
    });

    await expect(transport.request(outbound())).resolves.toMatchObject({
      subject: "SIP/2.0 200 OK",
    });
    expect(order).toEqual(["event", "write"]);
  });

  test("rejects duplicate pending transaction keys before writing", async () => {
    const transport = createReadyTransport();
    const first = transport.request(outbound());

    await expect(transport.request(outbound())).rejects.toThrow(
      "same Call-ID and CSeq",
    );
    expect(socket.write).toHaveBeenCalledOnce();

    transport.dispose();
    await expect(first).rejects.toThrow("SIP transport closed");
  });

  test("rejects every request with the original socket error", async () => {
    const transport = createReadyTransport();
    const first = transport.request(outbound("call-a", "1 INVITE"));
    const second = transport.request(outbound("call-b", "2 INVITE"));
    const error = new Error("socket failed");

    socket.emit("error", error);

    await expect(first).rejects.toBe(error);
    await expect(second).rejects.toBe(error);
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  test("rejects every request when the socket closes", async () => {
    const transport = createReadyTransport();
    const pending = transport.request(outbound());

    socket.emit("close");

    await expect(pending).rejects.toThrow("SIP transport closed");
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(socket.eventNames()).toEqual([]);
  });

  test("disposes once and rejects subsequent operations", async () => {
    const transport = createReadyTransport();
    const pending = transport.request(outbound());

    transport.dispose();
    transport.dispose();

    await expect(pending).rejects.toThrow("SIP transport closed");
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(() => transport.send(outbound())).toThrow("SIP transport closed");
    await expect(transport.request(outbound())).rejects.toThrow(
      "SIP transport closed",
    );
  });
});
