import { RtpPacket } from 'werift-rtp';
import dgram from 'dgram';
import getPort from 'get-port';

import { RequestMessage, type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import DTMF from '../dtmf';
import CallSession from '.';
import { extractAddress, withoutTag } from '../utils';

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
    // wait for user to answer the call
    const answerHandler = (message: InboundMessage) => {
      if (message.headers.CSeq === this.sipMessage.headers.CSeq) {
        this.softphone.off('message', answerHandler);
        this.emit('answered');
      }
    };
    this.softphone.on('message', answerHandler);

    this.once('answered', async () => {
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
    });
  }

  public async cancel() {
    const requestMessage = new RequestMessage(`CANCEL ${extractAddress(this.remotePeer)} SIP/2.0`, {
      'Call-Id': this.callId,
      From: this.localPeer,
      To: withoutTag(this.remotePeer),
      Via: this.sipMessage.headers.Via,
      CSeq: this.sipMessage.headers.CSeq.replace(' INVITE', ' CANCEL'),
    });
    this.softphone.send(requestMessage);
  }
}

export default OutboundCallSession;
