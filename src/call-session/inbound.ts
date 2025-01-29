import CallSession from "./index.js";
import { type InboundMessage, OutboundMessage } from "../sip-message/index.js";
import type Softphone from "../index.js";
import { localKey, randomInt } from "../utils.js";

class InboundCallSession extends CallSession {
  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super(softphone, inviteMessage);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
    this.remoteKey = inviteMessage.body.match(
      /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
    )![1];
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
    const newMessage = new OutboundMessage(
      "SIP/2.0 200 OK",
      {
        Via: this.sipMessage.headers.Via,
        "Call-ID": this.sipMessage.headers["Call-ID"],
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
    this.softphone.send(newMessage);

    this.startLocalServices();
  }
}

export default InboundCallSession;
