import type CallSession from '.';
declare class Streamer {
    paused: boolean;
    private callSession;
    private buffer;
    private originalBuffer;
    private sequenceNumber;
    private timestamp;
    private ssrc;
    constructor(callSesstion: CallSession, buffer: Buffer);
    start(): Promise<void>;
    stop(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    get finished(): boolean;
    private sendPacket;
}
export default Streamer;
