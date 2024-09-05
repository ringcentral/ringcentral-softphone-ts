import SipMessage from '../sip-message';
declare class OutboundMessage extends SipMessage {
    constructor(subject?: string, headers?: {}, body?: string);
}
export default OutboundMessage;
