import EventEmitter from "node:events";
import tls, { TLSSocket } from "node:tls";

import waitFor from "wait-for-async";

import { ConnectionError } from "../errors/index.js";
import {
  InboundMessage,
  OutboundMessage,
} from "../sip-message/index.js";

export interface TransportOptions {
  host: string;
  port: number;
  rejectUnauthorized?: boolean;
}

/**
 * Handles SIP transport over TLS.
 * Responsible for:
 * - TLS connection management
 * - Message buffering and parsing
 * - Sending messages and waiting for replies
 */
export class SipTransport extends EventEmitter {
  public readonly socket: TLSSocket;
  private connected = false;
  private debugMode = false;
  private originalWrite?: TLSSocket["write"];

  public constructor(options: TransportOptions) {
    super();
    this.socket = tls.connect(
      {
        host: options.host,
        port: options.port,
        rejectUnauthorized: options.rejectUnauthorized ?? true,
      },
      () => {
        this.connected = true;
      },
    );

    this.setupMessageParsing();
  }

  private setupMessageParsing() {
    let cache = "";
    this.socket.on("data", (data) => {
      cache += data.toString("utf-8");
      if (!cache.endsWith("\r\n")) {
        return; // haven't received a complete message yet
      }
      // received two empty body messages
      const tempMessages = cache
        .split("\r\nContent-Length: 0\r\n\r\n")
        .filter((message) => message.trim() !== "");
      cache = "";
      for (let i = 0; i < tempMessages.length; i++) {
        if (!tempMessages[i].includes("Content-Length: ")) {
          tempMessages[i] = tempMessages[i] + "\r\nContent-Length: 0";
        }
      }
      for (const message of tempMessages) {
        this.emit("message", InboundMessage.fromString(message));
      }
    });
  }

  /**
   * Waits for the TLS connection to be established.
   * @throws ConnectionError if connection times out
   */
  public async waitForConnection(timeoutMs = 10000): Promise<void> {
    if (this.connected) {
      return;
    }
    await waitFor({
      interval: 100,
      times: Math.ceil(timeoutMs / 100),
      condition: () => this.connected,
    });
    if (!this.connected) {
      throw new ConnectionError("TLS connection timeout");
    }
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public get localAddress(): string | undefined {
    return this.socket.localAddress;
  }

  public get localPort(): number | undefined {
    return this.socket.localPort;
  }

  /**
   * Sends a SIP message without waiting for a reply.
   */
  public sendMessage(message: OutboundMessage): void {
    this.socket.write(message.toString());
  }

  /**
   * Sends a SIP message and waits for a reply with matching CSeq.
   */
  public sendAndWaitForReply(message: OutboundMessage): Promise<InboundMessage> {
    this.socket.write(message.toString());
    return new Promise<InboundMessage>((resolve) => {
      const messageListener = (inboundMessage: InboundMessage) => {
        // Match CSeq number: "12563 INVITE" vs "12563 ACK"
        if (
          inboundMessage.headers.CSeq.trim().split(/\s+/)[0] !==
            message.headers.CSeq.trim().split(/\s+/)[0]
        ) {
          return;
        }
        if (inboundMessage.subject.startsWith("SIP/2.0 100 ")) {
          return; // ignore provisional responses
        }
        this.off("message", messageListener);
        resolve(inboundMessage);
      };
      this.on("message", messageListener);
    });
  }

  /**
   * Enables debug mode - logs all sent and received messages.
   */
  public enableDebugMode(): void {
    if (this.debugMode) {
      return;
    }
    this.debugMode = true;

    // Log received messages
    this.on("message", (message) => {
      console.log(`Receiving...(${new Date()})\n` + message.toString());
    });

    // Wrap write to log sent messages
    this.originalWrite = this.socket.write.bind(this.socket);
    this.socket.write = ((message: string | Buffer) => {
      console.log(`Sending...(${new Date()})\n` + message);
      return this.originalWrite!(message);
    }) as TLSSocket["write"];
  }

  /**
   * Destroys the transport and cleans up resources.
   */
  public destroy(): void {
    this.socket.removeAllListeners();
    this.socket.destroy();
  }
}
