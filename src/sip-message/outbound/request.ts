import OutboundMessage from '.';
import { uuid } from '../../utils';

let cseq = Math.floor(Math.random() * 10000);

class RequestMessage extends OutboundMessage {
  public constructor(subject = '', headers = {}, body = '') {
    super(subject, headers, body);
    this.newCseq();
  }

  public newCseq() {
    this.headers.CSeq = `${++cseq} ${this.subject.split(' ')[0]}`;
  }

  public fork() {
    const newMessage = new RequestMessage(this.subject, { ...this.headers }, this.body);
    newMessage.newCseq();
    if (newMessage.headers.Via) {
      newMessage.headers.Via = newMessage.headers.Via.replace(/;branch=.+?$/, `;branch=${uuid()}`);
    }
    return newMessage;
  }
}

export default RequestMessage;
