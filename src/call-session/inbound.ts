import CallSession from '.';
import { ResponseMessage, type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import { localKey } from '../utils';

class InboundCallSession extends CallSession {
  public constructor(
    softphone: Softphone,
    inviteMessage: InboundMessage,
    udpPort: number,
  ) {
    super(softphone, inviteMessage);
    this.udpPort = udpPort;
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
    this.remoteKey = inviteMessage.body.match(
      /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
    )![1];
  }

  public async answer() {
    const answerSDP = `
v=0
o=- ${Date.now()} 0 IN IP4 127.0.0.1
s=rc-softphone-ts
c=IN IP4 ${this.softphone.client.localAddress}
t=0 0
m=audio ${this.udpPort} RTP/SAVP 0 101
a=rtpmap:0 PCMU/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
a=sendrecv
a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${localKey}
`.trim();
    const newMessage = new ResponseMessage(
      this.sipMessage,
      200,
      {
        'Content-Type': 'application/sdp',
      },
      answerSDP,
    );
    this.softphone.send(newMessage);

    this.startLocalServices();
  }
}

export default InboundCallSession;
