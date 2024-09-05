import type SipInfoResponse from '@rc-ex/core/lib/definitions/SipInfoResponse';
import EventEmitter from 'events';
import net from 'net';
import type { OutboundMessage } from './sip-message';
import { InboundMessage } from './sip-message';
import InboundCallSession from './call-session/inbound';
import OutboundCallSession from './call-session/outbound';
declare class Softphone extends EventEmitter {
    sipInfo: SipInfoResponse;
    client: net.Socket;
    fakeDomain: string;
    fakeEmail: string;
    private intervalHandle;
    private connected;
    constructor(sipInfo: SipInfoResponse);
    register(): Promise<void>;
    enableDebugMode(): Promise<void>;
    revoke(): Promise<void>;
    send(message: OutboundMessage, waitForReply?: boolean): Promise<InboundMessage>;
    answer(inviteMessage: InboundMessage): Promise<InboundCallSession>;
    decline(inviteMessage: InboundMessage): Promise<void>;
    call(callee: number, callerId?: number): Promise<OutboundCallSession>;
}
export default Softphone;
