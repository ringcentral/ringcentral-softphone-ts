import EventEmitter from 'events';
import dgram from 'dgram';
import { type InboundMessage } from '../sip-message';
import type Softphone from '../softphone';
import Streamer from './streamer';
declare abstract class CallSession extends EventEmitter {
    softphone: Softphone;
    sipMessage: InboundMessage;
    socket: dgram.Socket;
    localPeer: string;
    remotePeer: string;
    remoteIP: string;
    remotePort: number;
    disposed: boolean;
    constructor(softphone: Softphone, sipMessage: InboundMessage);
    get callId(): string;
    send(data: string | Buffer): void;
    transfer(target: string): Promise<void>;
    hangup(): Promise<void>;
    sendDTMF(char: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '*' | '#'): Promise<void>;
    streamAudio(input: Buffer): Streamer;
    protected startLocalServices(): Promise<void>;
    private dispose;
}
export default CallSession;
