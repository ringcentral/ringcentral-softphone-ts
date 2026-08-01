import type Softphone from "../index.js";
import { type InboundMessage, ResponseMessage } from "../sip-message.js";
import CallSession from "./index.js";
import { MediaTransport } from "./media.js";

class InboundCallSession extends CallSession {
  public static async answer(
    softphone: Softphone,
    inviteMessage: InboundMessage,
  ) {
    const media = await MediaTransport.bind(softphone.codec);
    let session: InboundCallSession | undefined;
    try {
      session = new InboundCallSession(softphone, inviteMessage, media);
      session.sdp = softphone.createSdp(media.localPort);
      const response = new ResponseMessage(
        inviteMessage,
        "200 OK",
        {
          Contact: `<sip:${softphone.sipInfo.username}@${softphone.signaling.localAddress}:${softphone.signaling.localPort};transport=TLS;ob>`,
          Allow:
            "PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS",
          Supported: "replaces, 100rel, timer, norefersub",
          "Session-Expires": "14400;refresher=uac",
          Require: "timer",
          "Content-Type": "application/sdp",
        },
        session.sdp,
      );
      const ackMessage = await softphone.signaling.request(response);

      // for inbound call from call queue, ack message may HAVE body (while invite message has no body)
      session.startLocalServices(ackMessage.body || inviteMessage.body);
      return session;
    } catch (error) {
      session?.dispose();
      media.dispose();
      throw error;
    }
  }

  public constructor(
    softphone: Softphone,
    inviteMessage: InboundMessage,
    media: MediaTransport,
  ) {
    super(softphone, inviteMessage, media);
    this.localPeer = inviteMessage.getHeader("To")!;
    this.remotePeer = inviteMessage.getHeader("From")!;
  }
}

export default InboundCallSession;
