import type SipInfoResponse from '@rc-ex/core/lib/definitions/SipInfoResponse';
import EventEmitter from 'events';
import net from 'net';
import dgram from 'dgram';
import fs from 'fs';
import { RtpPacket } from 'werift-rtp';

import type { OutboundMessage } from './sip-message';
import { InboundMessage, RequestMessage, ResponseMessage } from './sip-message';
import { generateAuthorization, uuid } from './utils';

const sipInfo: SipInfoResponse = {
  domain: process.env.SIP_INFO_DOMAIN,
  password: process.env.SIP_INFO_PASSWORD,
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
  username: process.env.SIP_INFO_USERNAME,
};

const fakeDomain = uuid() + '.invalid';
const fakeEmail = uuid() + '@' + fakeDomain;
const fromTag = uuid();
const callId = uuid();

const emitter = new EventEmitter();
const client = new net.Socket();
const tokens = sipInfo.outboundProxy!.split(':');
client.connect(parseInt(tokens[1], 10), tokens[0], () => {
  emitter.emit('connected');
});
client.on('data', (data) => {
  const message = data.toString('utf-8');
  console.log('Receiving...\n' + message);
  emitter.emit('message', InboundMessage.fromString(message));
});

const oldWrite = client.write.bind(client);
client.write = (message) => {
  console.log('Sending...\n' + message);
  return oldWrite(message);
};

// todo: send answer should NOT wait for reply
const send = (message: OutboundMessage) => {
  client.write(message.toString());
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
      emitter.off('message', messageListerner);
      resolve(inboundMessage);
    };
    emitter.on('message', messageListerner);
  });
};

const onConnected = async () => {
  const requestMessage = new RequestMessage(`REGISTER sip:${sipInfo.domain} SIP/2.0`, {
    'Call-Id': callId,
    Contact: `<sip:${fakeEmail};transport=ws>;expires=600`,
    From: `<sip:${sipInfo.username}@${sipInfo.domain}>;tag=${fromTag}`,
    To: `<sip:${sipInfo.username}@${sipInfo.domain}>`,
    Via: `SIP/2.0/TCP ${fakeDomain};branch=${uuid()}`,
  });
  const inboundMessage = await send(requestMessage);
  const wwwAuth = inboundMessage.headers['Www-Authenticate'] || inboundMessage!.headers['WWW-Authenticate'];
  const nonce = wwwAuth.match(/, nonce="(.+?)"/)![1];
  const newMessage = requestMessage.fork();
  newMessage.headers.Authorization = generateAuthorization(sipInfo, 'REGISTER', nonce);
  send(newMessage);
};
emitter.once('connected', onConnected);

emitter.on('message', async (inboundMessage: InboundMessage) => {
  if (!inboundMessage.subject.startsWith('INVITE sip:')) {
    return;
  }

  const RTP_PORT = 65106;
  const socket = dgram.createSocket('udp4');
  socket.on('listening', () => {
    const address = socket.address();
    console.log(`RTP listener is listening on ${address.address}:${address.port}`);
  });
  const filename = 'test.raw';
  if (fs.existsSync(filename)) {
    fs.unlinkSync(filename);
  }
  const writeStream = fs.createWriteStream(filename, { flags: 'a' });
  socket.on('message', (message, rinfo) => {
    console.log(rinfo);
    const rtpPacket = RtpPacket.deSerialize(message);
    console.log(rtpPacket);
    writeStream.write(rtpPacket.payload);
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
      Contact: `<sip:${fakeEmail};transport=ws>`,
      'Content-Type': 'application/sdp',
    },
    answerSDP,
  );
  send(newMessage);

  // send a DTMF to remote server so that it knows how to reply
  const remoteIP = inboundMessage.body.match(/c=IN IP4 ([\d.]+)/)![1];
  const remotePort = parseInt(inboundMessage.body.match(/m=audio (\d+) /)![1], 10);
  const dtmf_data = fs.readFileSync('./rtp_dtmf.bin'); // copied from https://github.com/shinyoshiaki/werift-webrtc/tree/develop/packages/rtp/tests/data
  socket.send(new Uint8Array(dtmf_data), remotePort, remoteIP, (...args) => {
    console.log('send dtmf callback', ...args);
  });
});
