import type Softphone from "../index.js";
import { type InboundMessage, ResponseMessage } from "../sip-message.js";
import CallSession from "./index.js";
import type { MediaTransport } from "./media.js";

class InboundCallSession extends CallSession {
  public constructor(
    softphone: Softphone,
    inviteMessage: InboundMessage,
    media: MediaTransport,
  ) {
    super(softphone, inviteMessage, media);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
  }

  public async answer() {
    this.sdp = this.softphone.createSdp(this.media.localPort);
    const response = new ResponseMessage(
      this.sipMessage,
      "200 OK",
      {
        Contact: `<sip:${this.softphone.sipInfo.username}@${this.softphone.client.localAddress}:${this.softphone.client.localPort};transport=TLS;ob>`,
        Allow:
          "PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS",
        Supported: "replaces, 100rel, timer, norefersub",
        "Session-Expires": "14400;refresher=uac",
        Require: "timer",
        "Content-Type": "application/sdp",
      },
      this.sdp,
    );
    const ackMessage = await this.softphone.send(response, true);

    // for inbound call from call queue, ack message may HAVE body (while invite message has no body)
    this.startLocalServices(ackMessage.body || this.sipMessage.body);
  }
}

export default InboundCallSession;
