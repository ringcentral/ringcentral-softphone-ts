import EventEmitter from "node:events";
import tls, { type TLSSocket } from "node:tls";

import {
  InboundMessage,
  type OutboundMessage,
  type SipMessage,
} from "./sip-message.js";

type SipTransportEventMap = {
  message: [message: InboundMessage];
  outboundMessage: [message: string];
};

type PendingRequest = {
  resolve: (message: InboundMessage) => void;
  reject: (error: unknown) => void;
};

type ReadyWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  abort: () => void;
};

const headerSeparator = Buffer.from("\r\n\r\n");
const transactionKey = (message: SipMessage) => {
  const callId = message.getHeader("Call-ID")?.trim();
  const cseq = message.getHeader("CSeq")?.match(/^\s*(\d+)\b/)?.[1];
  if (!callId || !cseq) {
    throw new Error("Cannot correlate SIP message without Call-ID and CSeq");
  }
  return `${callId}\0${cseq}`;
};

export class SipTransport extends EventEmitter<SipTransportEventMap> {
  private socket: TLSSocket;
  private buffer = Buffer.alloc(0);
  private connected = false;
  private closed = false;
  private terminalError?: Error;
  private pending = new Map<string, PendingRequest>();
  private readyWaiters = new Set<ReadyWaiter>();

  private constructor(socket: TLSSocket) {
    super();
    this.socket = socket;
    socket.once("secureConnect", () => this.markReady());
    socket.on("data", (data) =>
      this.receive(Buffer.isBuffer(data) ? data : Buffer.from(data)),
    );
    socket.once("error", (error) => this.fail(error));
    socket.once("close", () =>
      this.fail(new Error("SIP transport closed"), false),
    );
  }

  public static connect(options: {
    outboundProxy: string;
    ignoreTlsCertErrors: boolean;
  }) {
    const proxy = new URL(`tls://${options.outboundProxy}`);
    return new SipTransport(
      tls.connect({
        host: proxy.hostname.replace(/^\[(.*)]$/, "$1"),
        port: Number(proxy.port),
        rejectUnauthorized: !options.ignoreTlsCertErrors,
      }),
    );
  }

  public get localAddress() {
    return this.socket.localAddress!;
  }

  public get localPort() {
    return this.socket.localPort!;
  }

  public ready(signal: AbortSignal): Promise<void> {
    if (this.connected) {
      return Promise.resolve();
    }
    if (this.terminalError) {
      return Promise.reject(this.terminalError);
    }

    return new Promise((resolve, reject) => {
      const waiter: ReadyWaiter = {
        resolve,
        reject,
        signal,
        abort: () => {
          this.readyWaiters.delete(waiter);
          reject(signal.reason);
        },
      };
      if (signal.aborted) {
        waiter.abort();
        return;
      }
      signal.addEventListener("abort", waiter.abort, { once: true });
      this.readyWaiters.add(waiter);
    });
  }

  public send(message: OutboundMessage): void {
    this.assertReady();
    this.write(message);
  }

  public async request(message: OutboundMessage): Promise<InboundMessage> {
    this.assertReady();
    const key = transactionKey(message);
    if (this.pending.has(key)) {
      throw new Error(
        "A SIP request with the same Call-ID and CSeq is pending",
      );
    }

    return new Promise((resolve, reject) => {
      this.pending.set(key, { resolve, reject });
      try {
        this.write(message);
      } catch (error) {
        this.pending.delete(key);
        reject(error);
      }
    });
  }

  public dispose(): void {
    this.fail(new Error("SIP transport closed"));
  }

  private assertReady() {
    if (this.terminalError) {
      throw this.terminalError;
    }
    if (!this.connected) {
      throw new Error("SIP transport is not ready");
    }
  }

  private write(message: OutboundMessage) {
    const wireMessage = message.toString();
    this.emit("outboundMessage", wireMessage);
    this.socket.write(wireMessage);
  }

  private markReady() {
    this.connected = true;
    for (const waiter of this.readyWaiters) {
      waiter.signal.removeEventListener("abort", waiter.abort);
      waiter.resolve();
    }
    this.readyWaiters.clear();
  }

  private receive(data: Buffer) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (!this.closed) {
      let message: InboundMessage | undefined;
      try {
        message = this.readMessage();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (!message) {
        return;
      }

      let key: string | undefined;
      try {
        key = transactionKey(message);
      } catch {
        // Uncorrelatable messages remain observable to signaling consumers.
      }
      const pending = key ? this.pending.get(key) : undefined;
      if (pending && !message.subject.startsWith("SIP/2.0 100 ")) {
        this.pending.delete(key!);
        pending.resolve(message);
      }
      this.emit("message", message);
    }
  }

  private readMessage(): InboundMessage | undefined {
    while (this.buffer.subarray(0, 2).equals(Buffer.from("\r\n"))) {
      this.buffer = this.buffer.subarray(2);
    }

    const headerEnd = this.buffer.indexOf(headerSeparator);
    if (headerEnd === -1) {
      return;
    }

    const headers = this.buffer
      .subarray(0, headerEnd)
      .toString("utf8")
      .split("\r\n")
      .slice(1)
      .filter((line) => /^(?:content-length|l)\s*:/i.test(line));
    if (headers.length === 0) {
      throw new Error("Invalid SIP message: missing Content-Length");
    }

    const values = headers.map(
      (line) => line.match(/^[^:]+:\s*(\d+)\s*$/)?.[1],
    );
    if (values.some((value) => value === undefined)) {
      throw new Error("Invalid SIP message: invalid Content-Length");
    }
    if (new Set(values).size !== 1) {
      throw new Error("Invalid SIP message: conflicting Content-Length");
    }

    const contentLength = Number(values[0]);
    if (!Number.isSafeInteger(contentLength)) {
      throw new Error("Invalid SIP message: invalid Content-Length");
    }
    const messageEnd = headerEnd + headerSeparator.length + contentLength;
    if (this.buffer.length < messageEnd) {
      return;
    }

    const message = InboundMessage.fromString(
      this.buffer.subarray(0, messageEnd).toString("utf8"),
    );
    this.buffer = this.buffer.subarray(messageEnd);
    return message;
  }

  private fail(error: Error, destroy = true) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.connected = false;
    this.terminalError = error;

    for (const waiter of this.readyWaiters) {
      waiter.signal.removeEventListener("abort", waiter.abort);
      waiter.reject(error);
    }
    this.readyWaiters.clear();
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();

    this.socket.removeAllListeners();
    this.removeAllListeners();
    if (destroy) {
      this.socket.destroy();
    }
  }
}
