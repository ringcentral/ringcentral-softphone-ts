import type Softphone from "../index.js";
import { type InboundMessage, ResponseMessage } from "../sip-message.js";
import CallSession from "./index.js";
import { MediaTransport } from "./media.js";

class InboundCallSession extends CallSession {
  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super(softphone, inviteMessage);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
    // inbound call from call queue, invite message may not have body
    if (inviteMessage.body.length > 0) {
      this.media.remoteKey = inviteMessage.body.match(
        /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
      )![1];
    }
  }

  public async answer() {
    const { socket, port } = await MediaTransport.createBoundSocket();
    this.media.socket = socket;
    this.sdp = this.softphone.createSdp(port);
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
    if (ackMessage.body.length > 0) {
      this.media.remoteIP = ackMessage.body.match(/c=IN IP4 ([\d.]+)/)![1];
      this.media.remotePort = parseInt(
        ackMessage.body.match(/m=audio (\d+) /)![1],
        10,
      );
      this.media.remoteKey = ackMessage.body.match(
        /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
      )![1];
    }

    this.startLocalServices();
  }
}

export default InboundCallSession;
