import CallSession from "./index";
import { type InboundMessage, RequestMessage } from "../sip-message/index";
import type Softphone from "../index";
import { extractAddress, withoutTag } from "../utils";

class OutboundCallSession extends CallSession {
  public constructor(softphone: Softphone, answerMessage: InboundMessage) {
    super(softphone, answerMessage);
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
}

export default OutboundCallSession;
