import OutboundMessage from '.';
import responseCodes from '../response-codes';
import type InboundMessage from '../inbound';
import { uuid } from '../../utils';

const toTag = uuid();

class ResponseMessage extends OutboundMessage {
  // eslint-disable-next-line max-params
  public constructor(inboundMessage: InboundMessage, responseCode: number, headers = {}, body = '') {
    super(undefined, { ...headers }, body);
    this.subject = `SIP/2.0 ${responseCode} ${responseCodes[responseCode]}`;
    const keys = ['Via', 'From', 'Call-Id', 'CSeq'];
    for (const key of keys) {
      if (inboundMessage.headers[key]) {
        this.headers[key] = inboundMessage.headers[key];
      }
    }
    this.headers.To = `${inboundMessage.headers.To};tag=${toTag}`;
    this.headers.Supported = 'outbound';
    this.headers = { ...this.headers, ...headers }; // user provided headers override auto headers
  }
}

export default ResponseMessage;
