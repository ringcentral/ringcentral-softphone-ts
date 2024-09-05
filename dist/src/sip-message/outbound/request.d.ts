import OutboundMessage from '.';
declare class RequestMessage extends OutboundMessage {
    constructor(subject?: string, headers?: {}, body?: string);
    newCseq(): void;
    fork(): RequestMessage;
}
export default RequestMessage;
