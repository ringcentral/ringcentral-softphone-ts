import CallSession from "./index.js";
import { type InboundMessage, OutboundMessage } from "../sip-message/index.js";
import type Softphone from "../index.js";
import { localKey, randomInt } from "../utils.js";

class InboundCallSession extends CallSession {
  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super(softphone, inviteMessage);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
    // inbound call from call queue, invite message may not have body
    if (inviteMessage.body.length > 0) {
      const keyMatch = inviteMessage.body.match(
        /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
      );
      if (!keyMatch) {
        throw new Error(
          "Inbound call failed: missing SRTP key (AES_CM_128_HMAC_SHA1_80) in INVITE SDP body",
        );
      }
      this.remoteKey = keyMatch[1];
    }
  }

  public async answer() {
    const answerSDP = `
v=0
o=- ${Date.now()} 0 IN IP4 ${this.softphone.client.localAddress}
s=rc-softphone-ts
c=IN IP4 ${this.softphone.client.localAddress}
t=0 0
m=audio ${randomInt()} RTP/SAVP ${this.softphone.codec.id} 101
a=rtpmap:${this.softphone.codec.id} ${this.softphone.codec.name}
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
a=sendrecv
a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${localKey}
`.trim();
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
      const ipMatch = ackMessage.body.match(/c=IN IP4 ([\d.]+)/);
      if (!ipMatch) {
        throw new Error(
          "Inbound call failed: missing connection line (c=IN IP4) in ACK SDP body",
        );
      }
      this.remoteIP = ipMatch[1];
      const portMatch = ackMessage.body.match(/m=audio (\d+) /);
      if (!portMatch) {
        throw new Error(
          "Inbound call failed: missing media line (m=audio) in ACK SDP body",
        );
      }
      this.remotePort = parseInt(portMatch[1], 10);
      const keyMatch = ackMessage.body.match(
        /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
      );
      if (!keyMatch) {
        throw new Error(
          "Inbound call failed: missing SRTP key (AES_CM_128_HMAC_SHA1_80) in ACK SDP body",
        );
      }
      this.remoteKey = keyMatch[1];
    }

    this.startLocalServices();
  }
}

export default InboundCallSession;
