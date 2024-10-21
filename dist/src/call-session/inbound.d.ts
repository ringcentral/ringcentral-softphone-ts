import { type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import CallSession from '.';
export type Protocol = {
    id: number;
    rtpmap: string;
    fmtp?: string;
};
export declare const defaultProtocols: Protocol[];
export declare function createSDPAnswer(protocols?: Protocol[], client?: string): string;
declare class InboundCallSession extends CallSession {
    constructor(softphone: Softphone, inviteMessage: InboundMessage);
    answer(protocols?: Protocol[], client?: string): Promise<void>;
}
export default InboundCallSession;
