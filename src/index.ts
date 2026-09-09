import EventEmitter from "node:events";
import InboundCallSession from "./call-session/inbound.js";
import type CallSession from "./call-session/index.js";
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
  private reconnectHandle?: NodeJS.Timeout;
  private recoveryTransport?: SipTransport;
  private callSessions = new Set<CallSession>();
  private recoveringSessions = new Set<CallSession>();
  private registered = false;
  private revoked = false;
  private recoveryAttempt = 0;
  private instanceId = uuid();
  private registerCallId = uuid();

  public constructor(sipInfo: SoftphoneOptions) {
    super();
    this.sipInfo = normalizeSoftphoneOptions(sipInfo);
    this.codec = new Codec(this.sipInfo.codec);

    this.signaling = this.createTransport();
  }

  public async register(): Promise<void> {
    await this.registerTransport(this.signaling);
    this.registered = true;
    this.startRegistrationRefresh();

    this.on("message", (inboundMessage: InboundMessage) => {
      if (
        inboundMessage.method !== "INVITE" ||
        !inboundMessage.subject.startsWith("INVITE sip:")
      ) {
        return;
      }
      this.signaling.send(new ResponseMessage(inboundMessage, "100 Trying"));
      this.emit("invite", inboundMessage as unknown as InboundInvite);
    });
  }

  private async registerTransport(signaling: SipTransport): Promise<void> {
    const signal = AbortSignal.timeout(10_000);
    try {
      await signaling.ready(signal);
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
          Via: `SIP/2.0/TLS ${signaling.localAddress}:${signaling.localPort};rport;branch=${branch()};alias`,
          "Max-Forwards": "70",
          From: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${uuid()}`,
          To: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>`,
          "Call-ID": this.registerCallId,
          Contact: `<sip:${this.sipInfo.username}@${signaling.localAddress}:${signaling.localPort};transport=TLS;ob>;reg-id=1;+sip.instance="<urn:uuid:${this.instanceId}>"`,
          Expires: 3600,
          Allow:
            "PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS",
        },
      );
      const inboundMessage = await signaling.request(requestMessage);
      if (inboundMessage.statusCode === 200) {
        // sometimes the server will return 200 OK directly
        return;
      }
      if (inboundMessage.statusCode !== 401) {
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
      const message = await signaling.request(newMessage);
      if (message.statusCode !== 200) {
        throw new Error(`Failed to register: ${message.subject}`);
      }
    };

    await sipRegister();
  }

  private createTransport(): SipTransport {
    const signaling = SipTransport.connect(this.sipInfo);
    signaling.on("message", (message) => this.emit("message", message));
    signaling.on("outboundMessage", (message) =>
      this.emit("outboundMessage", message),
    );
    signaling.once("disconnected", (error) =>
      this.handleDisconnect(signaling, error),
    );
    return signaling;
  }

  private startRegistrationRefresh(): void {
    clearInterval(this.intervalHandle);
    this.intervalHandle = setInterval(() => {
      this.registerTransport(this.signaling).catch((error: unknown) => {
        if (this.recoveryTransport) {
          return;
        }
        this.emit(
          "registrationError",
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }, 30 * 1000);
  }

  private handleDisconnect(signaling: SipTransport, error: Error): void {
    if (this.revoked || !this.registered || signaling !== this.signaling) {
      return;
    }
    this.registered = false;
    clearInterval(this.intervalHandle);
    for (const session of this.callSessions) {
      this.recoveringSessions.add(session);
      session.startSignalingRecoveryDeadline();
    }
    this.emit("registrationError", error);
    void this.recover();
  }

  private async recover(): Promise<void> {
    if (this.revoked || this.recoveryTransport) {
      return;
    }
    const signaling = this.createTransport();
    this.recoveryTransport = signaling;
    try {
      await this.registerTransport(signaling);
      if (this.revoked || this.recoveryTransport !== signaling) {
        return;
      }
      this.signaling = signaling;
      this.recoveryTransport = undefined;
      this.recoveryAttempt = 0;
      this.registered = true;
      this.startRegistrationRefresh();
      const sessions = [...this.recoveringSessions];
      this.recoveringSessions.clear();
      for (const session of sessions) {
        void session.reconcileDialog();
      }
    } catch (error) {
      if (this.revoked || this.recoveryTransport !== signaling) {
        return;
      }
      signaling.dispose();
      this.recoveryTransport = undefined;
      this.emit(
        "registrationError",
        error instanceof Error ? error : new Error(String(error)),
      );
      const delays = [1, 2, 4, 8, 16, 30];
      const delay = delays[Math.min(this.recoveryAttempt++, delays.length - 1)];
      this.reconnectHandle = setTimeout(
        () => void this.recover(),
        delay * 1000,
      );
    }
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
    this.revoked = true;
    this.registered = false;
    clearInterval(this.intervalHandle);
    clearTimeout(this.reconnectHandle);
    this.recoveryTransport?.dispose();
    this.recoveryTransport = undefined;
    for (const session of this.recoveringSessions) {
      session.cancelSignalingRecoveryDeadline();
    }
    this.recoveringSessions.clear();
    this.removeAllListeners();
    this.signaling.dispose();
  }

  /** @internal */
  public addCallSession(session: CallSession): void {
    this.callSessions.add(session);
  }

  /** @internal */
  public removeCallSession(session: CallSession): void {
    this.callSessions.delete(session);
    this.recoveringSessions.delete(session);
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
