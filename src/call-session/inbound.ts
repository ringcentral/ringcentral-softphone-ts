import type Softphone from "../index.js";
import { type InboundMessage, OutboundMessage } from "../sip-message.js";
import CallSession from "./index.js";

class InboundCallSession extends CallSession {
  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super(softphone, inviteMessage);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
    // inbound call from call queue, invite message may not have body
    if (inviteMessage.body.length > 0) {
      this.remoteKey = inviteMessage.body.match(
        /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
      )![1];
    }
  }

  public async answer() {
    const { socket, port } = await CallSession.createBoundSocket();
    this.socket = socket;
    const answerSDP = this.softphone.createSdp(port);
    this.sdp = answerSDP;
    const newMessage = new OutboundMessage(
      "SIP/2.0 200 OK",
      {
        Via: this.sipMessage.headers.Via,
        "Call-ID": this.sipMessage.getHeader("Call-ID"),
        From: this.sipMessage.headers.From,
        To: this.sipMessage.headers.To,
        CSeq: this.sipMessage.headers.CSeq,
        Contact: `<sip:${this.softphone.sipInfo.username}@${this.softphone.client.localAddress}:${this.softphone.client.localPort};transport=TLS;ob>`,
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
      this.remoteIP = ackMessage.body.match(/c=IN IP4 ([\d.]+)/)![1];
      this.remotePort = parseInt(
        ackMessage.body.match(/m=audio (\d+) /)![1],
        10,
      );
      this.remoteKey = ackMessage.body.match(
        /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
      )![1];
    }

    this.startLocalServices();
  }
}

export default InboundCallSession;
