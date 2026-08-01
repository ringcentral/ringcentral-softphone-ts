import EventEmitter from "node:events";

import InboundCallSession from "./call-session/inbound.js";
import OutboundCallSession from "./call-session/outbound.js";
import Codec from "./codec.js";
import {
  type InboundMessage,
  RequestMessage,
  ResponseMessage,
} from "./sip-message.js";
import { SipTransport } from "./sip-transport.js";
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
  public signaling: SipTransport;
  /** @internal */
  public codec: Codec;

  /** @internal */
  public fakeDomain = `${uuid()}.invalid`;

  private intervalHandle?: NodeJS.Timeout;
  private instanceId = uuid();
  private registerCallId = uuid();

  public constructor(sipInfo: SoftphoneOptions) {
    super();
    this.sipInfo = normalizeSoftphoneOptions(sipInfo);
    this.codec = new Codec(this.sipInfo.codec);

    this.signaling = SipTransport.connect(this.sipInfo);
    this.signaling.on("message", (message) => this.emit("message", message));
    this.signaling.on("outboundMessage", (message) =>
      this.emit("outboundMessage", message),
    );
  }

  public async register(): Promise<void> {
    const signal = AbortSignal.timeout(10_000);
    try {
      await this.signaling.ready(signal);
    } catch (error) {
      if (signal.aborted) {
        throw new Error("Failed to register: connect to TLS timeout");
      }
      throw error;
    }

    const sipRegister = async () => {
      const requestMessage = new RequestMessage(
        `REGISTER sip:${this.sipInfo.domain} SIP/2.0`,
        {
          Via: `SIP/2.0/TLS ${this.signaling.localAddress}:${this.signaling.localPort};rport;branch=${branch()};alias`,
          "Max-Forwards": "70",
          From: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${uuid()}`,
          To: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>`,
          "Call-ID": this.registerCallId,
          Contact: `<sip:${this.sipInfo.username}@${this.signaling.localAddress}:${this.signaling.localPort};transport=TLS;ob>;reg-id=1;+sip.instance="<urn:uuid:${this.instanceId}>"`,
          Expires: 3600,
          Allow:
            "PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS",
        },
      );
      const inboundMessage = await this.signaling.request(requestMessage);
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
      const message = await this.signaling.request(newMessage);
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
      this.signaling.send(new ResponseMessage(inboundMessage, "100 Trying"));
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
    this.signaling.dispose();
  }

  /** @internal */
  public createSdp(port: number): string {
    return `
v=0
o=- ${Date.now()} 0 IN IP4 ${this.signaling.localAddress}
s=rc-softphone-ts
c=IN IP4 ${this.signaling.localAddress}
t=0 0
m=audio ${port} RTP/SAVP ${this.codec.id} 101
a=rtpmap:${this.codec.id} ${this.codec.name}
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
a=sendrecv
a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${localKey}
`.trim();
  }

  public async answer(invite: InboundInvite): Promise<PublicCallSession> {
    return InboundCallSession.answer(this, invite as unknown as InboundMessage);
  }

  // decline an inbound call
  public async decline(invite: InboundInvite): Promise<void> {
    this.signaling.send(
      new ResponseMessage(invite as unknown as InboundMessage, "603 Decline"),
    );
  }

  public async call(callee: string): Promise<PublicOutboundCallSession> {
    return OutboundCallSession.call(this, callee);
  }
}

export default Softphone;
