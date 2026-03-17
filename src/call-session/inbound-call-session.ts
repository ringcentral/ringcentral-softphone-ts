import { CallSession } from "./call-session.js";
import type { InboundMessage } from "../sip-message/inbound-message.js";
import { OutboundMessage } from "../sip-message/outbound/outbound-message.js";
import type { Softphone } from "../index.js";
import { SdpBuilder, SdpParser } from "../sip/sdp.js";

export class InboundCallSession extends CallSession {
  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super(softphone, inviteMessage);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
    // inbound call from call queue, invite message may not have body
    if (inviteMessage.body.length > 0) {
      this.remoteKey = SdpParser.extractSrtpKey(
        inviteMessage.body,
        "Inbound call failed",
      );
    }
  }

  public async answer() {
    const answerSDP = SdpBuilder.create({
      localAddress: this.softphone.client.localAddress!,
      codecId: this.softphone.codec.id,
      codecName: this.softphone.codec.name,
      localKey: this.localKey,
    });
    this.sdp = answerSDP;
    const newMessage = new OutboundMessage(
      "SIP/2.0 200 OK",
      {
        Via: this.sipMessage.headers.Via,
        "Call-ID": this.sipMessage.getHeader("Call-ID"),
        From: this.sipMessage.headers.From,
        To: this.sipMessage.headers.To,
        CSeq: this.sipMessage.headers.CSeq,
        Contact:
          `<sip:${this.softphone.sipInfo.username}@${this.softphone.client.localAddress}:${this.softphone.client.localPort};transport=TLS;ob>`,
        Allow:
          "PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS",
        Supported: "replaces, 100rel, timer, norefersub",
        "Session-Expires": "14400;refresher=uac",
        Require: "timer",
        "Content-Type": "application/sdp",
      },
      answerSDP,
    );
    const ackMessage = await this.softphone.send(newMessage, true);

    // for inbound call from call queue, ack message may HAVE body (while invite message has no body)
    if (ackMessage.body.length > 0) {
      const parsed = SdpParser.parse(ackMessage.body, "Inbound call failed");
      this.remoteIP = parsed.ip;
      this.remotePort = parsed.port;
      this.remoteKey = parsed.srtpKey;
    }

    this.startLocalServices();
  }
}
