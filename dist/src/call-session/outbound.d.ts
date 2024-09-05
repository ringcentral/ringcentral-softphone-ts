import { type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import CallSession from '.';
declare class OutboundCallSession extends CallSession {
    constructor(softphone: Softphone, answerMessage: InboundMessage);
    init(): Promise<void>;
    cancel(): Promise<void>;
}
export default OutboundCallSession;
