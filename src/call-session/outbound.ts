import { RtpPacket } from 'werift-rtp';
import dgram from 'dgram';
import getPort from 'get-port';

import { RequestMessage, type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import DTMF from '../dtmf';
import CallSession from '.';
import { uuid } from '../utils';

class OutboundCallSession extends CallSession {
  public callee: string;

  public constructor(softphone: Softphone, answerMessage: InboundMessage) {
    super(softphone, answerMessage);
    this.localPeer = answerMessage.headers.From;
    this.remotePeer = answerMessage.headers.To;
    this.callee = this.remotePeer.match(/<sip:(\d+)@sip.ringcentral.com>;tag=/)[1];
    this.init();
  }

  public async init() {
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
    const rtpPort = await getPort();
    this.socket.bind(rtpPort);

    // send a message to remote server so that it knows where to reply
    this.send('hello');
  }

  // todo: simplify this method, not all data are required
  public async cancel() {
    const requestMessage = new RequestMessage(`CANCEL sip:${this.callee}@${this.softphone.sipInfo.domain} SIP/2.0`, {
      'Call-Id': this.callId,
      From: this.localPeer,
      To: `<sip:${this.callee}@${this.softphone.sipInfo.domain}>`,
      Via: `SIP/2.0/TCP ${this.softphone.fakeDomain};branch=${uuid()}`,
    });
    requestMessage.headers.CSeq = this.sipMessage.headers.CSeq.replace('INVITE', 'CANCEL');
    // The line below is essential
    requestMessage.headers.Via = this.sipMessage.headers.Via;
    this.softphone.send(requestMessage);
  }
}

export default OutboundCallSession;
