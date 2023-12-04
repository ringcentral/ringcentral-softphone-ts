import getPort from 'get-port';
import { RtpPacket } from 'werift-rtp';
import EventEmitter from 'events';
import dgram from 'dgram';
import fs from 'fs';

import { ResponseMessage, type InboundMessage } from './sip-message';
import { uuid } from './utils';
import type Softphone from './softphone';

class InboundCallSession extends EventEmitter {
  public inviteMessage: InboundMessage;
  public softphone: Softphone;
  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super();
    this.softphone = softphone;
    this.inviteMessage = inviteMessage;
  }
  public get callId() {
    return this.inviteMessage.headers['Call-Id'];
  }
  public async answer() {
    const RTP_PORT = await getPort();
    const socket = dgram.createSocket('udp4');
    socket.on('message', (message) => {
      this.emit('rtpPacket', RtpPacket.deSerialize(message));
    });
    socket.bind(RTP_PORT);

    const answerSDP =
      `
v=0
o=- ${RTP_PORT} 0 IN IP4 127.0.0.1
s=rc-softphone-ts
c=IN IP4 127.0.0.1
t=0 0
m=audio ${RTP_PORT} RTP/AVP 0 101
a=rtpmap:0 PCMU/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv
a=ssrc:${RTP_PORT} cname:${uuid()}
`.trim() + '\r\n';
    const newMessage = new ResponseMessage(
      this.inviteMessage,
      200,
      {
        'Content-Type': 'application/sdp',
      },
      answerSDP,
    );
    this.softphone.send(newMessage);

    // send a DTMF to remote server so that it knows how to reply
    const remoteIP = this.inviteMessage.body.match(/c=IN IP4 ([\d.]+)/)![1];
    const remotePort = parseInt(this.inviteMessage.body.match(/m=audio (\d+) /)![1], 10);
    const dtmf_data = fs.readFileSync('./rtp_dtmf.bin'); // copied from https://github.com/shinyoshiaki/werift-webrtc/tree/develop/packages/rtp/tests/data
    socket.send(new Uint8Array(dtmf_data), remotePort, remoteIP);
  }
}

export default InboundCallSession;
