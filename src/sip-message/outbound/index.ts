import SipMessage from '../sip-message';

class OutboundMessage extends SipMessage {
  public constructor(subject = '', headers = {}, body = '') {
    super(subject, headers, body);
    this.headers['Content-Length'] = this.body.length.toString();
    this.headers['User-Agent'] = 'ringcentral-softphone-2';
  }
}

export default OutboundMessage;
