import { SipAuthError, SipRegistrationError } from "../errors.js";
import { SIP_REGISTRATION_EXPIRES_SECONDS } from "../constants.js";
import { RequestMessage } from "../sip-message/outbound/request-message.js";
import { SipCredentials } from "../types.js";
import { branch, generateAuthorization, uuid } from "../utils.js";
import { SipTransport } from "./transport.js";

const REGISTRATION_REFRESH_INTERVAL_MS = 30 * 1000;

export type RegistrarConfig = SipCredentials;

/**
 * Handles SIP registration and periodic re-registration.
 */
export class SipRegistrar {
  private readonly transport: SipTransport;
  private readonly config: RegistrarConfig;
  private readonly instanceId = uuid();
  private readonly callId = uuid();
  private intervalHandle?: NodeJS.Timeout;
  private onError?: (error: Error) => void;

  public constructor(transport: SipTransport, config: RegistrarConfig) {
    this.transport = transport;
    this.config = config;
  }

  /**
   * Sets the error handler for registration refresh failures.
   */
  public setErrorHandler(handler: (error: Error) => void): void {
    this.onError = handler;
  }

  /**
   * Performs SIP registration and starts the refresh interval.
   * @throws SipRegistrationError if registration fails
   */
  public async register(): Promise<void> {
    await this.doRegister();
    this.startRefreshInterval();
  }

  private async doRegister(): Promise<void> {
    const fromTag = uuid();
    const requestMessage = new RequestMessage(
      `REGISTER sip:${this.config.domain} SIP/2.0`,
      {
        Via:
          `SIP/2.0/TLS ${this.transport.localAddress}:${this.transport.localPort};rport;branch=${branch()};alias`,
        "Max-Forwards": "70",
        From:
          `<sip:${this.config.username}@${this.config.domain}>;tag=${fromTag}`,
        To: `<sip:${this.config.username}@${this.config.domain}>`,
        "Call-ID": this.callId,
        Contact:
          `<sip:${this.config.username}@${this.transport.localAddress}:${this.transport.localPort};transport=TLS;ob>;reg-id=1;+sip.instance="<urn:uuid:${this.instanceId}>"`,
        Expires: SIP_REGISTRATION_EXPIRES_SECONDS,
        Allow:
          "PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS",
      },
    );

    const response = await this.transport.sendAndWaitForReply(requestMessage);

    if (response.subject.startsWith("SIP/2.0 200 ")) {
      // Registration successful without authentication
      return;
    }

    // Need to authenticate
    const wwwAuth = response.getHeader("Www-Authenticate");
    if (!wwwAuth) {
      throw new SipAuthError(
        "SIP registration failed: missing Www-Authenticate header in 401 response",
      );
    }

    const nonceMatch = wwwAuth.match(/, nonce="(.+?)"/);
    if (!nonceMatch) {
      throw new SipAuthError(
        `SIP registration failed: malformed Www-Authenticate header, missing nonce: ${wwwAuth}`,
      );
    }

    const authMessage = requestMessage.fork();
    authMessage.headers.Authorization = generateAuthorization(
      this.config,
      nonceMatch[1],
      "REGISTER",
    );

    const authResponse = await this.transport.sendAndWaitForReply(authMessage);
    if (!authResponse.subject.startsWith("SIP/2.0 200 ")) {
      throw new SipRegistrationError(
        "Failed to register: " + authResponse.subject,
      );
    }
  }

  private startRefreshInterval(): void {
    // Clear any existing interval to prevent duplicates
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }

    this.intervalHandle = setInterval(() => {
      this.doRegister().catch((error) => {
        if (this.onError) {
          this.onError(error);
        }
      });
    }, REGISTRATION_REFRESH_INTERVAL_MS);
  }

  /**
   * Stops the registration refresh interval.
   */
  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }
}
