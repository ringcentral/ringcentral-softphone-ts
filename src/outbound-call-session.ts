import { RtpPacket } from 'werift-rtp';
import EventEmitter from 'events';
import dgram from 'dgram';

import type { InboundMessage } from './sip-message';
import type Softphone from './softphone';
import DTMF from './dtmf';

class OutboundCallSession extends EventEmitter {
  public softphone: Softphone;
  public rtpPort: number;
  public answerMessage: InboundMessage;
  public socket: dgram.Socket;
  public remoteIP: string;
  public remotePort: number;
  public constructor(softphone, answerMessage: InboundMessage, rtpPort: number) {
    super();
    this.softphone = softphone;
    this.rtpPort = rtpPort;
    this.answerMessage = answerMessage;
    this.remoteIP = this.answerMessage.body.match(/c=IN IP4 ([\d.]+)/)![1];
    this.remotePort = parseInt(this.answerMessage.body.match(/m=audio (\d+) /)![1], 10);
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

  public get callId() {
    return this.answerMessage.headers['Call-Id'];
  }

  private send(data: string | Buffer) {
    this.socket.send(data, this.remotePort, this.remoteIP);
  }
}

export default OutboundCallSession;
