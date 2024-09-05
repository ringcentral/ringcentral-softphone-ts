declare class SipMessage {
    subject: string;
    headers: {
        [key: string]: string;
    };
    body: string;
    constructor(subject?: string, headers?: {}, body?: string);
    toString(): string;
}
export default SipMessage;
