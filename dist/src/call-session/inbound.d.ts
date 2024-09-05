import { type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import CallSession from '.';
declare class InboundCallSession extends CallSession {
    constructor(softphone: Softphone, inviteMessage: InboundMessage);
    answer(): Promise<void>;
}
export default InboundCallSession;
