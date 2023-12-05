import type SipInfoResponse from '@rc-ex/core/lib/definitions/SipInfoResponse';
import EventEmitter from 'events';
import net from 'net';
import waitFor from 'wait-for-async';

import type { OutboundMessage } from './sip-message';
import { InboundMessage, RequestMessage, ResponseMessage } from './sip-message';
import { generateAuthorization, uuid } from './utils';
import InboundCallSession from './inbound-call-session';

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
    const sipRegister = async () => {
      const requestMessage = new RequestMessage(`REGISTER sip:${this.sipInfo.domain} SIP/2.0`, {
        'Call-Id': this.callId,
        Contact: `<sip:${this.fakeEmail};transport=tcp>;expires=600`,
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
    this.client.on('data', (data) => console.log('Receiving...\n' + data.toString('utf-8')));
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

  public async answer(inviteMessage: InboundMessage) {
    const inboundCallSession = new InboundCallSession(this, inviteMessage);
    await inboundCallSession.answer();
    return inboundCallSession;
  }

  public async decline(inviteMessage: InboundMessage) {
    const newMessage = new ResponseMessage(inviteMessage, 603);
    this.send(newMessage);
  }

  public async call(to: string) {
    // todo: make outbound call
  }
}

export default Softphone;
