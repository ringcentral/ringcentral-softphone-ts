import type dgram from "node:dgram";
import type Softphone from "../index.js";
import { type InboundMessage, RequestMessage } from "../sip-message.js";
import { extractAddress, withoutTag } from "../utils.js";
import CallSession from "./index.js";

export const parseTelephonyId = (
  header: string | undefined,
  name: "party-id" | "session-id",
): string | undefined =>
  header?.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`, "i"))?.[1]?.trim() ||
  undefined;

class OutboundCallSession extends CallSession {
  public constructor(
    softphone: Softphone,
    answerMessage: InboundMessage,
    socket: dgram.Socket,
  ) {
    super(softphone, answerMessage);
    this.socket = socket;
    this.localPeer = answerMessage.headers.From;
    this.remotePeer = answerMessage.headers.To;
    this.remoteKey = answerMessage.body.match(
      /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
    )![1];
    this.init();
  }

  public init() {
    // wait for user to answer the call
    const answerHandler = (message: InboundMessage) => {
      if (message.headers.CSeq !== this.sipMessage.headers.CSeq) {
        return;
      }
      if (message.subject.startsWith("SIP/2.0 486")) {
        this.softphone.off("message", answerHandler);
        this.emit("busy");
        this.dispose();
        return;
      }
      if (message.subject.startsWith("SIP/2.0 200")) {
        this.softphone.off("message", answerHandler);
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
        this.softphone.send(ackMessage);
      }
    };
    this.softphone.on("message", answerHandler);
    this.once("answered", () => this.startLocalServices());
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
    await this.softphone.send(requestMessage);
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
}

export default OutboundCallSession;
