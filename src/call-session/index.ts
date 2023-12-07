import EventEmitter from 'events';
import type dgram from 'dgram';

import type { InboundMessage } from '../sip-message';
import type Softphone from '../softphone';

class CallSession extends EventEmitter {
  public softphone: Softphone;
  public sipMessage: InboundMessage;
  public socket: dgram.Socket;
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
}

export default CallSession;
