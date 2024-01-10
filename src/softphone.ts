import type SipInfoResponse from '@rc-ex/core/lib/definitions/SipInfoResponse';
import EventEmitter from 'events';
import net from 'net';
import waitFor from 'wait-for-async';

import type { OutboundMessage } from './sip-message';
import { InboundMessage, RequestMessage, ResponseMessage } from './sip-message';
import { branch, generateAuthorization, randomInt, uuid } from './utils';
import InboundCallSession from './call-session/inbound';
import OutboundCallSession from './call-session/outbound';

class Softphone extends EventEmitter {
  public sipInfo: SipInfoResponse;
  public client: net.Socket;

  public fakeDomain = uuid() + '.invalid';
  public fakeEmail = uuid() + '@' + this.fakeDomain;

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

    let cache = '';
    this.client.on('data', (data) => {
      cache += data.toString('utf-8');
      if (!cache.endsWith('\r\n')) {
        return; // haven't received a complete message yet
      }
      const tempMessages = cache.split('\r\n\r\nSIP/2.0 ');
      cache = '';
      for (let i = 1; i < tempMessages.length; i++) {
        // received 2 or more messages in one go
        tempMessages[i] = 'SIP/2.0 ' + tempMessages[i];
      }
      for (const message of tempMessages) {
        this.emit('message', InboundMessage.fromString(message));
      }
    });
  }

  public async register() {
    if (!this.connected) {
      await waitFor({ interval: 100, condition: () => this.connected });
    }
    const sipRegister = async () => {
      const requestMessage = new RequestMessage(`REGISTER sip:${this.sipInfo.domain} SIP/2.0`, {
        'Call-Id': uuid(),
        Contact: `<sip:${this.fakeEmail};transport=tcp>;expires=600`,
        From: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${uuid()}`,
        To: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>`,
        Via: `SIP/2.0/TCP ${this.fakeDomain};branch=${branch()}`,
      });
      const inboundMessage = await this.send(requestMessage, true);
      const wwwAuth = inboundMessage.headers['Www-Authenticate'] || inboundMessage!.headers['WWW-Authenticate'];
      const nonce = wwwAuth.match(/, nonce="(.+?)"/)![1];
      const newMessage = requestMessage.fork();
      newMessage.headers.Authorization = generateAuthorization(this.sipInfo, nonce, 'REGISTER');
      this.send(newMessage);
    };
    sipRegister();
    this.intervalHandle = setInterval(
      () => {
        sipRegister();
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
    this.on('message', (message) => console.log(`Receiving...(${new Date()})\n` + message.toString()));
    const tcpWrite = this.client.write.bind(this.client);
    this.client.write = (message) => {
      console.log(`Sending...(${new Date()})\n` + message);
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
        if (inboundMessage.subject.startsWith('SIP/2.0 100 ')) {
          return; // ignore
        }
        this.off('message', messageListerner);
        resolve(inboundMessage);
      };
      this.on('message', messageListerner);
    });
  }

  public async answer(inviteMessage: InboundMessage) {
    const inboundCallSession = new InboundCallSession(this, inviteMessage);
    await inboundCallSession.answer();
    return inboundCallSession;
  }

  // decline an inbound call
  public async decline(inviteMessage: InboundMessage) {
    const newMessage = new ResponseMessage(inviteMessage, 603);
    this.send(newMessage);
  }

  public async call(callee: number, callerId?: number) {
    const offerSDP = `
v=0
o=- ${randomInt()} 0 IN IP4 127.0.0.1
s=rc-softphone-ts
c=IN IP4 127.0.0.1
t=0 0
m=audio ${randomInt()} RTP/AVP 0 101
a=rtpmap:0 PCMU/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
a=sendrecv
  `.trim();
    const inviteMessage = new RequestMessage(
      `INVITE sip:${callee}@${this.sipInfo.domain} SIP/2.0`,
      {
        'Call-Id': uuid(),
        Contact: `<sip:${this.fakeEmail};transport=tcp>;expires=600`,
        From: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${uuid()}`,
        To: `<sip:${callee}@${this.sipInfo.domain}>`,
        Via: `SIP/2.0/TCP ${this.fakeDomain};branch=${branch()}`,
        'Content-Type': 'application/sdp',
      },
      offerSDP,
    );
    if (callerId) {
      inviteMessage.headers['P-Asserted-Identity'] = `sip:${callerId}@${this.sipInfo.domain}`;
    }
    const inboundMessage = await this.send(inviteMessage, true);
    const proxyAuthenticate = inboundMessage.headers['Proxy-Authenticate'];
    const nonce = proxyAuthenticate.match(/, nonce="(.+?)"/)![1];
    const newMessage = inviteMessage.fork();
    newMessage.headers['Proxy-Authorization'] = generateAuthorization(this.sipInfo, nonce, 'INVITE');
    const progressMessage = await this.send(newMessage, true);
    return new OutboundCallSession(this, progressMessage);
  }
}

export default Softphone;
