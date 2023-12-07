import getPort from 'get-port';
import { RtpPacket } from 'werift-rtp';
import dgram from 'dgram';

import { ResponseMessage, type InboundMessage } from '../sip-message';
import { uuid } from '../utils';
import type Softphone from '../softphone';
import DTMF from '../dtmf';
import CallSession from '.';

class InboundCallSession extends CallSession {
  public disposed = false;
  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super(softphone, inviteMessage);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
  }
  public async answer() {
    this.rtpPort = await getPort();
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (message) => {
      const rtpPacket = RtpPacket.deSerialize(message);
      this.emit('rtpPacket', rtpPacket);
      if (rtpPacket.header.payloadType === 101) {
        this.emit('dtmfPacket', rtpPacket);
        const char = DTMF.payloadToChar(rtpPacket.payload);
        if (char) {
          this.emit('dtmf', char);
        }
      } else {
        this.emit('audioPacket', rtpPacket);
      }
    });
    this.socket.bind(this.rtpPort);

    // send a message to remote server so that it knows where to reply
    this.send('hello');

    const answerSDP = `
v=0
o=- ${this.rtpPort} 0 IN IP4 127.0.0.1
s=rc-softphone-ts
c=IN IP4 127.0.0.1
t=0 0
m=audio ${this.rtpPort} RTP/AVP 0 101
a=rtpmap:0 PCMU/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
a=sendrecv
a=ssrc:${this.rtpPort} cname:${uuid()}
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

    const byeHandler = (inboundMessage: InboundMessage) => {
      if (inboundMessage.headers['Call-Id'] !== this.callId) {
        return;
      }
      if (inboundMessage.headers.CSeq.endsWith(' BYE')) {
        this.softphone.off('message', byeHandler);
        this.dispose();
      }
    };
    this.softphone.on('message', byeHandler);
  }

  private dispose() {
    this.disposed = true;
    this.emit('disposed');
    this.socket.removeAllListeners();
    this.socket.close();
  }
}

export default InboundCallSession;
