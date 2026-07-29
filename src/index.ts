import EventEmitter, { once } from "node:events";
import tls, { type TLSSocket } from "node:tls";

import InboundCallSession from "./call-session/inbound.js";
import CallSession from "./call-session/index.js";
import OutboundCallSession from "./call-session/outbound.js";
import Codec from "./codec.js";
import {
  InboundMessage,
  OutboundMessage,
  RequestMessage,
  ResponseMessage,
} from "./sip-message.js";
import {
  type InboundInvite,
  type NormalizedSoftphoneOptions,
  normalizeSoftphoneOptions,
  type CallSession as PublicCallSession,
  type OutboundCallSession as PublicOutboundCallSession,
  type SoftphoneEventMap,
  type SoftphoneOptions,
} from "./types.js";
import { branch, generateAuthorization, localKey, uuid } from "./utils.js";

export type {
  CallSession,
  InboundInvite,
  OutboundCallSession,
  SoftphoneOptions,
  Streamer,
} from "./types.js";

class Softphone extends EventEmitter<SoftphoneEventMap> {
  /** @internal */
  public sipInfo: NormalizedSoftphoneOptions;
  /** @internal */
  public client: TLSSocket;
  /** @internal */
  public codec: Codec;

  /** @internal */
  public fakeDomain = `${uuid()}.invalid`;

  /** @internal */
  private intervalHandle?: NodeJS.Timeout;
  /** @internal */
  private connected = false;
  /** @internal */
  private instanceId = uuid();
  /** @internal */
  private registerCallId = uuid();

  public constructor(sipInfo: SoftphoneOptions) {
    super();
    this.sipInfo = normalizeSoftphoneOptions(sipInfo);
    this.codec = new Codec(this.sipInfo.codec);

    const proxy = new URL(`tls://${this.sipInfo.outboundProxy}`);
    this.client = tls.connect(
      {
        host: proxy.hostname.replace(/^\[(.*)]$/, "$1"),
        port: Number(proxy.port),
        rejectUnauthorized: !this.sipInfo.ignoreTlsCertErrors,
      },
      () => {
        this.connected = true;
      },
    );
    const tlsWrite = this.client.write.bind(this.client);
    this.client.write = (message) => {
      this.emit("outboundMessage", message.toString());
      return tlsWrite(message);
    };

    let cache = "";
    this.client.on("data", (data) => {
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
          tempMessages[i] = `${tempMessages[i]}\r\nContent-Length: 0`;
        }
      }
      for (const message of tempMessages) {
        this.emit("message", InboundMessage.fromString(message));
      }
    });
  }

  public async register(): Promise<void> {
    if (!this.connected) {
      const signal = AbortSignal.timeout(10_000);
      try {
        await once(this.client, "secureConnect", { signal });
      } catch (error) {
        if (
          signal.aborted &&
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          throw new Error("Failed to register: connect to TLS timeout");
        }
        throw error;
      }
    }

    const sipRegister = async () => {
      const fromTag = uuid();
      const requestMessage = new RequestMessage(
        `REGISTER sip:${this.sipInfo.domain} SIP/2.0`,
        {
          Via: `SIP/2.0/TLS ${this.client.localAddress}:${this.client.localPort};rport;branch=${branch()};alias`,
          "Max-Forwards": "70",
          From: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${fromTag}`,
          To: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>`,
          "Call-ID": this.registerCallId,
          Contact: `<sip:${this.sipInfo.username}@${this.client.localAddress}:${this.client.localPort};transport=TLS;ob>;reg-id=1;+sip.instance="<urn:uuid:${this.instanceId}>"`,
          Expires: 3600,
          Allow:
            "PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS",
        },
      );
      const inboundMessage = await this.send(requestMessage, true);
      if (inboundMessage.subject.startsWith("SIP/2.0 200 ")) {
        // sometimes the server will return 200 OK directly
        return;
      }
      if (!inboundMessage.subject.startsWith("SIP/2.0 401 ")) {
        throw new Error(`Failed to register: ${inboundMessage.subject}`);
      }
      const wwwAuth = inboundMessage.getHeader("Www-Authenticate")!;
      const nonce = wwwAuth.match(/, nonce="(.+?)"/)![1];
      const newMessage = requestMessage.fork();
      newMessage.headers.Authorization = generateAuthorization(
        this.sipInfo,
        nonce,
        "REGISTER",
      );
      const message = await this.send(newMessage, true);
      if (!message.subject.startsWith("SIP/2.0 200 ")) {
        throw new Error(`Failed to register: ${message.subject}`);
      }
    };

    await sipRegister();
    this.intervalHandle = setInterval(() => {
      sipRegister().catch((error: unknown) => {
        this.emit(
          "registrationError",
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }, 30 * 1000);

    this.on("message", (inboundMessage: InboundMessage) => {
      if (!inboundMessage.subject.startsWith("INVITE sip:")) {
        return;
      }
      const outboundMessage = new OutboundMessage("SIP/2.0 100 Trying", {
        Via: inboundMessage.headers.Via,
        "Call-ID": inboundMessage.getHeader("Call-ID"),
        From: inboundMessage.headers.From,
        To: inboundMessage.headers.To,
        CSeq: inboundMessage.headers.CSeq,
        "Content-Length": "0",
      });
      this.send(outboundMessage);
      this.emit("invite", inboundMessage as unknown as InboundInvite);
    });
  }

  public enableDebugMode(
    options = {
      inboundPrefix: "Receiving...\n",
      outboundPrefix: "Sending...\n",
    },
  ): void {
    this.on("message", (message: InboundMessage) => {
      console.log(
        `${options.inboundPrefix}(${new Date()})\n${message.toString()}`,
      );
    });
    this.on("outboundMessage", (message: string) => {
      console.log(`${options.outboundPrefix}(${new Date()})\n${message}`);
    });
  }

  public revoke(): void {
    clearInterval(this.intervalHandle);
    this.removeAllListeners();
    this.client.removeAllListeners();
    this.client.destroy();
  }

  /** @internal */
  public send(
    message: OutboundMessage,
    waitForReply?: true,
  ): Promise<InboundMessage>;
  /** @internal */
  public send(
    message: OutboundMessage,
    waitForReply?: false,
  ): Promise<undefined>;
  /** @internal */
  public send(message: OutboundMessage, waitForReply = false) {
    this.client.write(message.toString());
    if (!waitForReply) {
      return Promise.resolve(undefined);
    }
    return new Promise<InboundMessage>((resolve) => {
      const messageListerner = (inboundMessage: InboundMessage) => {
        // "12563 INVITE" vs "12563 ACK"
        if (
          inboundMessage.headers.CSeq.trim().split(/\s+/)[0] !==
          message.headers.CSeq.trim().split(/\s+/)[0]
        ) {
          return;
        }
        if (inboundMessage.subject.startsWith("SIP/2.0 100 ")) {
          return; // ignore
        }
        this.off("message", messageListerner);
        resolve(inboundMessage);
      };
      this.on("message", messageListerner);
    });
  }

  public async answer(invite: InboundInvite): Promise<PublicCallSession> {
    const inboundCallSession = new InboundCallSession(
      this,
      invite as unknown as InboundMessage,
    );
    await inboundCallSession.answer();
    return inboundCallSession;
  }

  // decline an inbound call
  public async decline(invite: InboundInvite): Promise<void> {
    await this.send(
      new ResponseMessage(invite as unknown as InboundMessage, "603 Decline"),
    );
  }

  public async call(callee: string): Promise<PublicOutboundCallSession> {
    const { socket, port } = await CallSession.createBoundSocket();
    const offerSDP = `
v=0
o=- ${Date.now()} 0 IN IP4 ${this.client.localAddress}
s=rc-softphone-ts
c=IN IP4 ${this.client.localAddress}
t=0 0
m=audio ${port} RTP/SAVP ${this.codec.id} 101
a=rtpmap:${this.codec.id} ${this.codec.name}
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
a=sendrecv
a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${localKey}
  `.trim();
    const inviteMessage = new RequestMessage(
      `INVITE sip:${callee}@${this.sipInfo.domain} SIP/2.0`,
      {
        Via: `SIP/2.0/TLS ${this.client.localAddress}:${this.client.localPort};rport;branch=${branch()};alias`,
        "Max-Forwards": 70,
        From: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${uuid()}`,
        To: `<sip:${callee}@${this.sipInfo.domain}>`,
        Contact: ` <sip:${this.sipInfo.username}@${this.client.localAddress}:${this.client.localPort};transport=TLS;ob>`,
        "Call-ID": uuid(),
        Route: `<sip:${this.sipInfo.outboundProxy};transport=tls;lr>`,
        Allow: `PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS`,
        Supported: `replaces, 100rel, timer, norefersub`,
        "Session-Expires": 1800,
        "Min-SE": 90,
        "Content-Type": "application/sdp",
      },
      offerSDP,
    );
    const inboundMessage = await this.send(inviteMessage, true);
    const proxyAuthenticate = inboundMessage.getHeader("Proxy-Authenticate")!;
    const nonce = proxyAuthenticate.match(/, nonce="(.+?)"/)![1];
    const newMessage = inviteMessage.fork();
    newMessage.headers["Proxy-Authorization"] = generateAuthorization(
      this.sipInfo,
      nonce,
      "INVITE",
    );
    const progressMessage = await this.send(newMessage, true);
    let outboundCallSession: OutboundCallSession;
    try {
      outboundCallSession = new OutboundCallSession(
        this,
        progressMessage,
        socket,
      );
    } catch (error) {
      socket.close();
      throw error;
    }
    outboundCallSession.sdp = offerSDP;
    return outboundCallSession;
  }
}

export default Softphone;
