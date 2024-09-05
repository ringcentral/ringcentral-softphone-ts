import SipMessage from '../sip-message';
declare class InboundMessage extends SipMessage {
    static fromString(str: string): SipMessage;
}
export default InboundMessage;
