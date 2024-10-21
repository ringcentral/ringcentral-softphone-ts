import { ResponseMessage, type InboundMessage } from '../sip-message';
import { randomInt, extractPhoneNumber } from '../utils';
import type Softphone from '../softphone';
import CallSession from '.';

export type Protocol = { id: number, rtpmap: string, fmtp?: string };
export const defaultProtocols: Protocol[] = [
  { id: 0, rtpmap: 'pcmu/8000' },
  { id: 9, rtpmap: 'g722/8000' },
  // { id: 8, rtpmap: 'pcma/8000' },
  { id: 101, rtpmap: 'telephone-event/8000', fmtp: '0-15' },
  { id: 103, rtpmap: 'telephone-event/16000', fmtp: '0-15' },
]

export function createSDPAnswer(protocols: Protocol[] = defaultProtocols, client = 'rc-ssoftphone-ts') {
  const protocolIDs = protocols.map(p=>p.id).join(' ');
  const attributes = protocols.map(p=>`a=rtpmap:${p.id} ${p.rtpmap}`+(p.fmtp?`\na=fmtp:${p.id} ${p.fmtp}`:'')).join('\n');
  return `
v=0
o=- ${randomInt()} 0 IN IP4 127.0.0.1
s=${client}
c=IN IP4 127.0.0.1
t=0 0
m=audio ${randomInt()} RTP/AVP ${protocolIDs}
a=sendrecv
${attributes}`.trim();
}

class InboundCallSession extends CallSession {
  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super(softphone, inviteMessage);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
    this.To = extractPhoneNumber(this.localPeer);
    this.From = extractPhoneNumber(this.remotePeer);
  }

  public async answer(protocols?: Protocol[], client?: string) {
    const answerSDP = createSDPAnswer(protocols, client);
//     const answerSDP = `
// v=0
// o=- ${randomInt()} 0 IN IP4 127.0.0.1
// s=rc-softphone-ts
// c=IN IP4 127.0.0.1
// t=0 0
// m=audio ${randomInt()} RTP/AVP 0 8 9 101 103
// a=sendrecv
// a=rtpmap:0 PCMU/8000
// a=rtpmap:8 pcma/8000
// a=rtpmap:9 g722/8000
// a=rtpmap:101 telephone-event/8000
// a=fmtp:101 0-15
// a=rtpmap:103 telephone-event/16000
// a=fmtp:103 0-15
// `.trim();
    const newMessage = new ResponseMessage(
      this.sipMessage,
      200,
      {
        'Content-Type': 'application/sdp',
      },
      answerSDP,
    );
    this.softphone.send(newMessage);

    this.startLocalServices();
  }
}

export default InboundCallSession;
