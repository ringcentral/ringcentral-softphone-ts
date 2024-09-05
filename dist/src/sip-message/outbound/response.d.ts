import OutboundMessage from '.';
import type InboundMessage from '../inbound';
declare class ResponseMessage extends OutboundMessage {
    constructor(inboundMessage: InboundMessage, responseCode: number, headers?: {}, body?: string);
}
export default ResponseMessage;
