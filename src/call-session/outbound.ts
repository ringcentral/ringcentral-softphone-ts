import { RtpPacket } from 'werift-rtp';
import dgram from 'dgram';

import type { InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import DTMF from '../dtmf';
import CallSession from '.';

class OutboundCallSession extends CallSession {
  public rtpPort: number;
  public constructor(softphone: Softphone, answerMessage: InboundMessage, rtpPort: number) {
    super(softphone, answerMessage);
    this.rtpPort = rtpPort;
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
    this.socket.bind(this.rtpPort);

    // send a message to remote server so that it knows where to reply
    this.send('hello');
  }
}

export default OutboundCallSession;
