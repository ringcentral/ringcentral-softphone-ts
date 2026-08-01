import type Softphone from "../index.js";
import { type InboundMessage, RequestMessage } from "../sip-message.js";
import {
  branch,
  extractAddress,
  generateAuthorization,
  uuid,
  withoutTag,
} from "../utils.js";
import CallSession from "./index.js";
import { MediaTransport } from "./media.js";

// ponytail: RingCentral sends 183 with SDP before 200; add a state machine only if that contract changes.
const requireProgressMessage = (message: InboundMessage) => {
  if (!message.subject.startsWith("SIP/2.0 183 ")) {
    throw new Error(
      `Failed to start call: expected 183 Session Progress, received ${message.subject}`,
    );
  }
  if (
    !/c=IN IP4 [\d.]+/.test(message.body) ||
    !/m=audio \d+ /.test(message.body) ||
    !/AES_CM_128_HMAC_SHA1_80 inline:[\w+/]+/.test(message.body)
  ) {
    throw new Error(
      "Failed to start call: 183 Session Progress did not contain usable SDP",
    );
  }
  return message;
};

export const parseTelephonyId = (
  header: string | undefined,
  name: "party-id" | "session-id",
): string | undefined =>
  header?.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`, "i"))?.[1]?.trim() ||
  undefined;

class OutboundCallSession extends CallSession {
  public static async call(softphone: Softphone, callee: string) {
    const media = await MediaTransport.bind(softphone.codec);
    try {
      const offerSDP = softphone.createSdp(media.localPort);
      const inviteMessage = new RequestMessage(
        `INVITE sip:${callee}@${softphone.sipInfo.domain} SIP/2.0`,
        {
          Via: `SIP/2.0/TLS ${softphone.signaling.localAddress}:${softphone.signaling.localPort};rport;branch=${branch()};alias`,
          "Max-Forwards": 70,
          From: `<sip:${softphone.sipInfo.username}@${softphone.sipInfo.domain}>;tag=${uuid()}`,
          To: `<sip:${callee}@${softphone.sipInfo.domain}>`,
          Contact: ` <sip:${softphone.sipInfo.username}@${softphone.signaling.localAddress}:${softphone.signaling.localPort};transport=TLS;ob>`,
          "Call-ID": uuid(),
          Route: `<sip:${softphone.sipInfo.outboundProxy};transport=tls;lr>`,
          Allow: `PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS`,
          Supported: `replaces, 100rel, timer, norefersub`,
          "Session-Expires": 1800,
          "Min-SE": 90,
          "Content-Type": "application/sdp",
        },
        offerSDP,
      );
      const inboundMessage = await softphone.signaling.request(inviteMessage);
      const proxyAuthenticate = inboundMessage.getHeader("Proxy-Authenticate")!;
      const nonce = proxyAuthenticate.match(/, nonce="(.+?)"/)![1];
      const newMessage = inviteMessage.fork();
      newMessage.headers["Proxy-Authorization"] = generateAuthorization(
        softphone.sipInfo,
        nonce,
        "INVITE",
      );
      const progressMessage = await softphone.signaling.request(newMessage);
      const session = new OutboundCallSession(
        softphone,
        progressMessage,
        media,
      );
      session.sdp = offerSDP;
      return session;
    } catch (error) {
      media.dispose();
      throw error;
    }
  }

  // wait for user to answer the call
  private waitingForAnswer = true;

  public constructor(
    softphone: Softphone,
    answerMessage: InboundMessage,
    media: MediaTransport,
  ) {
    super(softphone, requireProgressMessage(answerMessage), media);
    this.localPeer = answerMessage.headers.From;
    this.remotePeer = answerMessage.headers.To;
  }

  public async cancel() {
    const requestMessage = new RequestMessage(
      `CANCEL ${extractAddress(this.remotePeer)} SIP/2.0`,
      {
        "Call-ID": this.callId,
        From: this.localPeer,
        To: withoutTag(this.remotePeer),
        Via: this.sipMessage.headers.Via,
        CSeq: this.sipMessage.headers.CSeq.replace(" INVITE", " CANCEL"),
      },
    );
    this.softphone.signaling.send(requestMessage);
  }

  public get sessionId() {
    return parseTelephonyId(
      this.sipMessage.getHeader("P-Rc-Api-Ids"),
      "session-id",
    );
  }

  public get partyId() {
    return parseTelephonyId(
      this.sipMessage.getHeader("P-Rc-Api-Ids"),
      "party-id",
    );
  }

  protected override handleSignalingMessage(message: InboundMessage) {
    if (
      !this.waitingForAnswer ||
      message.getHeader("CSeq") !== this.sipMessage.getHeader("CSeq") ||
      !message.subject.startsWith("SIP/2.0 ")
    ) {
      return;
    }
    this.waitingForAnswer = false;
    if (!message.subject.startsWith("SIP/2.0 200 ")) {
      this.emit("busy");
      this.dispose();
      return;
    }

    this.startLocalServices(this.sipMessage.body);
    this.emit("answered");
    const ackMessage = new RequestMessage(
      `ACK ${extractAddress(this.remotePeer)} SIP/2.0`,
      {
        "Call-ID": this.callId,
        From: this.localPeer,
        To: this.remotePeer,
        Via: this.sipMessage.headers.Via,
        CSeq: this.sipMessage.headers.CSeq.replace(" INVITE", " ACK"),
      },
    );
    this.softphone.signaling.send(ackMessage);
  }
}

export default OutboundCallSession;
