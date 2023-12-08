import EventEmitter from 'events';
import dgram from 'dgram';
import { RtpHeader, RtpPacket } from 'werift-rtp';

import { RequestMessage, type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import { randomInt, uuid } from '../utils';
import DTMF from '../dtmf';

abstract class CallSession extends EventEmitter {
  public softphone: Softphone;
  public sipMessage: InboundMessage;
  public socket: dgram.Socket;
  public localPeer: string;
  public remotePeer: string;
  public remoteIP: string;
  public remotePort: number;
  public disposed = false;

  public constructor(softphone: Softphone, sipMessage: InboundMessage) {
    super();
    this.softphone = softphone;
    this.sipMessage = sipMessage;
    this.remoteIP = this.sipMessage.body.match(/c=IN IP4 ([\d.]+)/)![1];
    this.remotePort = parseInt(this.sipMessage.body.match(/m=audio (\d+) /)![1], 10);
  }

  public get callId() {
    return this.sipMessage.headers['Call-Id'];
  }

  public send(data: string | Buffer) {
    this.socket.send(data, this.remotePort, this.remoteIP);
  }

  public async hangup() {
    const requestMessage = new RequestMessage(`BYE sip:${this.softphone.sipInfo.domain} SIP/2.0`, {
      'Call-Id': this.callId,
      From: this.localPeer,
      To: this.remotePeer,
      Via: `SIP/2.0/TCP ${this.softphone.fakeDomain};branch=${uuid()}`,
    });
    this.softphone.send(requestMessage);
  }

  public async sendDTMF(char: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '*' | '#') {
    const timestamp = Math.floor(Date.now() / 1000);
    let sequenceNumber = timestamp % 65536;
    const rtpHeader = new RtpHeader({
      version: 2,
      padding: false,
      paddingSize: 0,
      extension: false,
      marker: false,
      payloadOffset: 12,
      payloadType: 101,
      sequenceNumber,
      timestamp,
      ssrc: randomInt(),
      csrcLength: 0,
      csrc: [],
      extensionProfile: 48862,
      extensionLength: undefined,
      extensions: [],
    });
    for (const payload of DTMF.charToPayloads(char)) {
      rtpHeader.sequenceNumber = sequenceNumber++;
      const rtpPacket = new RtpPacket(rtpHeader, payload);
      this.send(rtpPacket.serialize());
    }
  }

  // buffer is the content of a audio file, it is supposed to be PCMU/8000 encoded.
  // The audio should be playable by command: ffplay -autoexit -f mulaw -ar 8000 test.raw
  public async streamAudio(input: Buffer) {
    let buffer = input;
    let sequenceNumber = randomInt();
    let timestamp = randomInt();
    const ssrc = randomInt();
    const sendPacket = () => {
      if (buffer.length >= 160) {
        const temp = buffer.subarray(0, 160);
        buffer = buffer.subarray(160);
        const rtpPacket = new RtpPacket(
          new RtpHeader({
            version: 2,
            padding: false,
            paddingSize: 0,
            extension: false,
            marker: false,
            payloadOffset: 12,
            payloadType: 0,
            sequenceNumber,
            timestamp,
            ssrc,
            csrcLength: 0,
            csrc: [],
            extensionProfile: 48862,
            extensionLength: undefined,
            extensions: [],
          }),
          temp,
        );
        if (this.disposed) {
          return;
        }
        this.send(rtpPacket.serialize());
        sequenceNumber += 1;
        timestamp += 160; // inbound audio use this time interval, in my opinion, it should be 20
      }
      setTimeout(() => sendPacket(), 20);
    };
    sendPacket();
  }

  protected async startLocalServices() {
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
    this.socket.bind();
    // send a message to remote server so that it knows where to reply
    this.send('hello');

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

export default CallSession;
