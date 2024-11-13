import CallSession from '.';
import { OutboundMessage, type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import { localKey, randomInt, extractPhoneNumber } from '../utils';

export type Protocol = { id: number, rtpmap: string, fmtp?: string };
export const defaultProtocols: Protocol[] = [
  { id: 0, rtpmap: 'pcmu/8000' },
  { id: 9, rtpmap: 'g722/8000' },
  // { id: 8, rtpmap: 'pcma/8000' },
  { id: 101, rtpmap: 'telephone-event/8000', fmtp: '0-15' },
  // { id: 103, rtpmap: 'telephone-event/16000', fmtp: '0-15' },
  // { id: 109, rtpmap: 'OPUS/16000', fmtp: 'useinbandfec=1;usedtx=0' },
]

export function createSDPAnswer(protocols: Protocol[] = defaultProtocols, client = 'rc-ssoftphone-ts') {
  const protocolIDs = protocols.map(p=>p.id).join(' ');
  const attributes = protocols.map(p=>`a=rtpmap:${p.id} ${p.rtpmap}`+(p.fmtp?`\na=fmtp:${p.id} ${p.fmtp}`:'')).join('\n');
  return `
v=0
o=- ${Date.now()} 0 IN IP4 ${this.softphone.client.localAddress}
s=${client}
c=IN IP4 ${this.softphone.client.localAddress}
t=0 0
m=audio ${randomInt()} RTP/AVP ${protocolIDs}
a=sendrecv
${attributes}
a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${localKey}
`.trim();
}

class InboundCallSession extends CallSession {
  public constructor(softphone: Softphone, inviteMessage: InboundMessage) {
    super(softphone, inviteMessage);
    this.localPeer = inviteMessage.headers.To;
    this.remotePeer = inviteMessage.headers.From;
    this.To = extractPhoneNumber(this.localPeer);
    this.From = extractPhoneNumber(this.remotePeer);
    this.remoteKey = inviteMessage.body.match(
      /AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/,
    )![1];
  }

  public async answer(protocols?: Protocol[], client?: string) {
    const answerSDP = createSDPAnswer(protocols, client);
    const newMessage = new OutboundMessage(
      'SIP/2.0 200 OK',
      {
        Via: this.sipMessage.headers.Via,
        'Call-ID': this.sipMessage.headers['Call-ID'],
        From: this.sipMessage.headers.From,
        To: this.sipMessage.headers.To,
        CSeq: this.sipMessage.headers.CSeq,
        Contact: `<sip:${this.softphone.sipInfo.username}@${this.softphone.client.localAddress}:${this.softphone.client.localPort};transport=TLS;ob>`,
        Allow:
          'PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS',
        Supported: 'replaces, 100rel, timer, norefersub',
        'Session-Expires': '14400;refresher=uac',
        Require: 'timer',
        'Content-Type': 'application/sdp',
      },
      answerSDP,
    );
    this.softphone.send(newMessage);

    this.startLocalServices();
  }
}

export default InboundCallSession;
