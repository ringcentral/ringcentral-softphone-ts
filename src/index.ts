import EventEmitter from "node:events";

import { InboundCallSession } from "./call-session/inbound-call-session.js";
import { OutboundCallSession } from "./call-session/outbound-call-session.js";
import { SIP_SESSION_EXPIRES_SECONDS } from "./constants.js";
import { SipAuthError } from "./errors.js";
import { SdpBuilder } from "./sip/sdp.js";
import { SipRegistrar } from "./sip/registrar.js";
import { SipTransport } from "./sip/transport.js";
import { InboundMessage } from "./sip-message/inbound-message.js";
import { OutboundMessage } from "./sip-message/outbound/outbound-message.js";
import { RequestMessage } from "./sip-message/outbound/request-message.js";
import { ResponseMessage } from "./sip-message/outbound/response-message.js";
import {
  branch,
  generateAuthorization,
  generateLocalKey,
  uuid,
} from "./utils.js";
import { SoftPhoneOptions } from "./types.js";
import { Codec } from "./codec.js";

/**
 * RingCentral Softphone client.
 *
 * This is the main entry point for making and receiving calls.
 * It orchestrates the SIP transport, registration, and call control.
 */
export class Softphone extends EventEmitter {
  public readonly sipInfo: SoftPhoneOptions;
  public readonly codec: Codec;

  private readonly transport: SipTransport;
  private readonly registrar: SipRegistrar;

  public readonly fakeDomain = uuid() + ".invalid";
  public readonly fakeEmail = uuid() + "@" + this.fakeDomain;

  private inviteHandler?: (inboundMessage: InboundMessage) => void;

  public constructor(sipInfo: SoftPhoneOptions) {
    super();

    // Apply defaults
    if (sipInfo.codec === undefined) {
      sipInfo.codec = "OPUS/16000";
    }
    if (sipInfo.domain === undefined) {
      sipInfo.domain = "sip.ringcentral.com";
    }
    if (sipInfo.outboundProxy === undefined) {
      sipInfo.outboundProxy = "sip10.ringcentral.com:5096";
    }

    this.sipInfo = sipInfo;
    this.codec = new Codec(sipInfo.codec);

    // Parse outbound proxy
    const tokens = sipInfo.outboundProxy.split(":");

    // Create transport
    this.transport = new SipTransport({
      host: tokens[0],
      port: parseInt(tokens[1], 10),
      rejectUnauthorized: !sipInfo.ignoreTlsCertErrors,
    });

    // Forward message events from transport
    this.transport.on("message", (message: InboundMessage) => {
      this.emit("message", message);
    });

    // Create registrar
    this.registrar = new SipRegistrar(this.transport, {
      domain: sipInfo.domain,
      username: sipInfo.username,
      password: sipInfo.password,
      authorizationId: sipInfo.authorizationId,
    });

    // Forward registration errors
    this.registrar.setErrorHandler((error) => {
      this.emit("registrationError", error);
    });
  }

  /**
   * Access to the underlying TLS socket (for backward compatibility).
   */
  public get client() {
    return this.transport.socket;
  }

  /**
   * Registers with the SIP server and starts listening for incoming calls.
   */
  public async register(): Promise<void> {
    await this.transport.waitForConnection();
    await this.registrar.register();
    this.setupInviteHandler();
  }

  private setupInviteHandler(): void {
    // Remove existing handler to prevent duplicates
    if (this.inviteHandler) {
      this.off("message", this.inviteHandler);
    }

    this.inviteHandler = (inboundMessage: InboundMessage) => {
      if (!inboundMessage.subject.startsWith("INVITE sip:")) {
        return;
      }
      // Send 100 Trying
      const tryingMessage = new OutboundMessage("SIP/2.0 100 Trying", {
        Via: inboundMessage.headers.Via,
        "Call-ID": inboundMessage.getHeader("Call-ID"),
        From: inboundMessage.headers.From,
        To: inboundMessage.headers.To,
        CSeq: inboundMessage.headers.CSeq,
        "Content-Length": "0",
      });
      this.send(tryingMessage);
      this.emit("invite", inboundMessage);
    };

    this.on("message", this.inviteHandler);
  }

  /**
   * Enables debug mode - logs all sent and received SIP messages.
   */
  public enableDebugMode(): void {
    this.transport.enableDebugMode();
  }

  /**
   * Unregisters and cleans up all resources.
   */
  public revoke(): void {
    this.registrar.stop();

    // Notify active call sessions to clean up
    this.emit("revoked");

    // Remove invite handler
    if (this.inviteHandler) {
      this.off("message", this.inviteHandler);
      this.inviteHandler = undefined;
    }

    this.transport.destroy();
  }

  /**
   * Sends a SIP message.
   */
  public send(
    message: OutboundMessage,
    waitForReply?: true,
  ): Promise<InboundMessage>;
  public send(
    message: OutboundMessage,
    waitForReply?: false,
  ): Promise<undefined>;
  public send(
    message: OutboundMessage,
    waitForReply = false,
  ): Promise<InboundMessage | undefined> {
    if (waitForReply) {
      return this.transport.sendAndWaitForReply(message);
    }
    this.transport.sendMessage(message);
    return Promise.resolve(undefined);
  }

  /**
   * Answers an incoming call.
   */
  public async answer(
    inviteMessage: InboundMessage,
  ): Promise<InboundCallSession> {
    const session = new InboundCallSession(this, inviteMessage);
    await session.answer();
    return session;
  }

  /**
   * Declines an incoming call.
   */
  public async decline(inviteMessage: InboundMessage): Promise<void> {
    const response = new ResponseMessage(inviteMessage, 603);
    await this.send(response);
  }

  /**
   * Initiates an outbound call.
   */
  public async call(callee: string): Promise<OutboundCallSession> {
    const localKey = generateLocalKey();
    const offerSDP = SdpBuilder.create({
      localAddress: this.client.localAddress!,
      codecId: this.codec.id,
      codecName: this.codec.name,
      localKey,
    });

    const inviteMessage = new RequestMessage(
      `INVITE sip:${callee}@${this.sipInfo.domain} SIP/2.0`,
      {
        Via:
          `SIP/2.0/TLS ${this.client.localAddress}:${this.client.localPort};rport;branch=${branch()};alias`,
        "Max-Forwards": 70,
        From:
          `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${uuid()}`,
        To: `<sip:${callee}@${this.sipInfo.domain}>`,
        Contact:
          ` <sip:${this.sipInfo.username}@${this.client.localAddress}:${this.client.localPort};transport=TLS;ob>`,
        "Call-ID": uuid(),
        Route: `<sip:${this.sipInfo.outboundProxy};transport=tls;lr>`,
        Allow:
          `PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS`,
        Supported: `replaces, 100rel, timer, norefersub`,
        "Session-Expires": SIP_SESSION_EXPIRES_SECONDS,
        "Min-SE": 90,
        "Content-Type": "application/sdp",
      },
      offerSDP,
    );

    const response = await this.send(inviteMessage, true);

    // Handle authentication
    const proxyAuth = response.getHeader("Proxy-Authenticate");
    if (!proxyAuth) {
      throw new SipAuthError(
        "Outbound call failed: missing Proxy-Authenticate header in response",
      );
    }

    const nonceMatch = proxyAuth.match(/, nonce="(.+?)"/);
    if (!nonceMatch) {
      throw new SipAuthError(
        `Outbound call failed: malformed Proxy-Authenticate header, missing nonce: ${proxyAuth}`,
      );
    }

    const authMessage = inviteMessage.fork();
    authMessage.headers["Proxy-Authorization"] = generateAuthorization(
      this.sipInfo,
      nonceMatch[1],
      "INVITE",
    );

    const progressMessage = await this.send(authMessage, true);
    const session = new OutboundCallSession(this, progressMessage, localKey);
    session.sdp = offerSDP;
    return session;
  }
}


// Re-export commonly used types
export { type SoftPhoneOptions } from "./types.js";
export * from "./errors.js";
