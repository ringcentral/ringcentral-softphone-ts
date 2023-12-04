import type SipInfoResponse from '@rc-ex/core/lib/definitions/SipInfoResponse';
import EventEmitter from 'events';
import net from 'net';
import dgram from 'dgram';
import fs from 'fs';
import { RtpPacket } from 'werift-rtp';
import waitFor from 'wait-for-async';

import type { OutboundMessage } from './sip-message';
import { InboundMessage, RequestMessage, ResponseMessage } from './sip-message';
import { generateAuthorization, uuid } from './utils';

class Softphone extends EventEmitter {
  public sipInfo: SipInfoResponse;
  public client: net.Socket;

  public fakeDomain = uuid() + '.invalid';
  public fakeEmail = uuid() + '@' + this.fakeDomain;
  public fromTag = uuid();
  public callId = uuid();

  private intervalHandle: NodeJS.Timeout;
  private connected = false;

  public constructor(sipInfo: SipInfoResponse) {
    super();
    this.sipInfo = sipInfo;
    if (this.sipInfo.domain === undefined) {
      this.sipInfo.domain = 'sip.ringcentral.com';
    }
    if (this.sipInfo.outboundProxy === undefined) {
      this.sipInfo.outboundProxy = 'sip112-1241.ringcentral.com:5091';
    }
    this.client = new net.Socket();
    const tokens = this.sipInfo.outboundProxy!.split(':');
    this.client.connect(parseInt(tokens[1], 10), tokens[0], () => {
      this.connected = true;
    });
    this.client.on('data', (data) => {
      const message = data.toString('utf-8');
      this.emit('message', InboundMessage.fromString(message));
    });
  }

  public async register() {
    if (!this.connected) {
      await waitFor({ interval: 100, condition: () => this.connected });
    }
    const requestMessage = new RequestMessage(`REGISTER sip:${this.sipInfo.domain} SIP/2.0`, {
      'Call-Id': this.callId,
      Contact: `<sip:${this.fakeEmail};transport=ws>;expires=600`,
      From: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${this.fromTag}`,
      To: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>`,
      Via: `SIP/2.0/TCP ${this.fakeDomain};branch=${uuid()}`,
    });
    const inboundMessage = (await this.send(requestMessage, true)) as InboundMessage;
    const wwwAuth = inboundMessage.headers['Www-Authenticate'] || inboundMessage!.headers['WWW-Authenticate'];
    const nonce = wwwAuth.match(/, nonce="(.+?)"/)![1];
    const newMessage = requestMessage.fork();
    newMessage.headers.Authorization = generateAuthorization(this.sipInfo, 'REGISTER', nonce);
    this.send(newMessage);
    this.intervalHandle = setInterval(
      () => {
        this.send(newMessage);
      },
      3 * 60 * 1000, // refresh registration every 3 minutes
    );
    this.on('message', (inboundMessage) => {
      if (!inboundMessage.subject.startsWith('INVITE sip:')) {
        return;
      }
      this.emit('invite', inboundMessage);
    });
  }

  public async enableDebugMode() {
    this.client.on('data', this.printData);
    const tcpWrite = this.client.write.bind(this.client);
    this.client.write = (message) => {
      console.log('Sending...\n' + message);
      return tcpWrite(message);
    };
  }

  public async revoke() {
    clearInterval(this.intervalHandle);
    this.removeAllListeners();
    this.client.removeAllListeners();
    this.client.destroy();
  }

  public send(message: OutboundMessage, waitForReply = false) {
    this.client.write(message.toString());
    if (!waitForReply) {
      return new Promise<undefined>((resolve) => {
        resolve(undefined);
      });
    }
    return new Promise<InboundMessage>((resolve) => {
      const messageListerner = (inboundMessage: InboundMessage) => {
        if (inboundMessage.headers.CSeq !== message.headers.CSeq) {
          return;
        }
        if (
          inboundMessage.subject === 'SIP/2.0 100 Trying' ||
          inboundMessage.subject === 'SIP/2.0 183 Session Progress'
        ) {
          return; // ignore
        }
        this.off('message', messageListerner);
        resolve(inboundMessage);
      };
      this.on('message', messageListerner);
    });
  }

  public async answer(inboundMessage: InboundMessage) {
    const RTP_PORT = 65106;
    const socket = dgram.createSocket('udp4');
    socket.on('listening', () => {
      const address = socket.address();
      console.log(`RTP listener is listening on ${address.address}:${address.port}`);
    });
    socket.on('message', (message) => {
      this.emit('rtpPacket', RtpPacket.deSerialize(message));
    });
    socket.bind(RTP_PORT);

    const answerSDP =
      `
v=0
o=- 1645658372 0 IN IP4 127.0.0.1
s=sipsorcery
c=IN IP4 127.0.0.1
t=0 0
m=audio ${RTP_PORT} RTP/AVP 0 101
a=rtpmap:0 PCMU/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv
a=ssrc:322229412 cname:fd410cd4-b177-47ad-ad5b-f52f93be65c1
`.trim() + '\r\n';
    const newMessage = new ResponseMessage(
      inboundMessage,
      200,
      {
        Contact: `<sip:${this.fakeEmail};transport=ws>`,
        'Content-Type': 'application/sdp',
      },
      answerSDP,
    );
    this.send(newMessage);

    // send a DTMF to remote server so that it knows how to reply
    const remoteIP = inboundMessage.body.match(/c=IN IP4 ([\d.]+)/)![1];
    const remotePort = parseInt(inboundMessage.body.match(/m=audio (\d+) /)![1], 10);
    const dtmf_data = fs.readFileSync('./rtp_dtmf.bin'); // copied from https://github.com/shinyoshiaki/werift-webrtc/tree/develop/packages/rtp/tests/data
    socket.send(new Uint8Array(dtmf_data), remotePort, remoteIP, (...args) => {
      console.log('send dtmf callback', ...args);
    });
  }

  private printData = (data: Buffer) => {
    console.log('Receiving...\n' + data.toString('utf-8'));
  };
}

export default Softphone;
