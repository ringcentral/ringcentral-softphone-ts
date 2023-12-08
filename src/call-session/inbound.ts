import { ResponseMessage, type InboundMessage } from '../sip-message';
import { randomInt, uuid } from '../utils';
import type Softphone from '../softphone';
import CallSession from '.';

class InboundCallSession extends CallSession {
  public disposed = false;

  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super(softphone, inviteMessage);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
  }

  public async answer() {
    const answerSDP = `
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
a=ssrc:${randomInt()} cname:${uuid()}
`.trim();
    const newMessage = new ResponseMessage(
      this.sipMessage,
      200,
      {
        'Content-Type': 'application/sdp',
      },
      answerSDP,
    );
    this.softphone.send(newMessage);

    this.startRtpServer();

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

export default InboundCallSession;
