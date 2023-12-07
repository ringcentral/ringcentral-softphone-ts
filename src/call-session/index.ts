import EventEmitter from 'events';
import type dgram from 'dgram';

import { RequestMessage, type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import { uuid } from '../utils';

abstract class CallSession extends EventEmitter {
  public softphone: Softphone;
  public sipMessage: InboundMessage;
  public socket: dgram.Socket;
  public localPeer: string;
  public remotePeer: string;
  private remoteIP: string;
  private remotePort: number;
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
}

export default CallSession;
