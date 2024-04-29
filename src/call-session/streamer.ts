import { RtpHeader, RtpPacket } from 'werift-rtp';

import type CallSession from '.';
import { randomInt } from '../utils';

class Streamer {
  public paused = false;
  private callSession: CallSession;
  private buffer: Buffer;
  private originalBuffer: Buffer;
  private sequenceNumber = randomInt();
  private timestamp = randomInt();
  private ssrc = randomInt();

  public constructor(callSesstion: CallSession, buffer: Buffer) {
    this.callSession = callSesstion;
    this.buffer = buffer;
    this.originalBuffer = buffer;
  }

  public async start() {
    this.buffer = this.originalBuffer;
    this.paused = false;
    this.sendPacket();
  }

  public async stop() {
    this.buffer = Buffer.alloc(0);
  }

  public async pause() {
    this.paused = true;
  }

  public async resume() {
    this.paused = false;
    this.sendPacket();
  }

  public get finished() {
    return this.buffer.length < 160;
  }

  private sendPacket() {
    if (!this.callSession.disposed && !this.paused && !this.finished) {
      const temp = this.buffer.subarray(0, 160);
      this.buffer = this.buffer.subarray(160);
      const rtpPacket = new RtpPacket(
        new RtpHeader({
          version: 2,
          padding: false,
          paddingSize: 0,
          extension: false,
          marker: false,
          payloadOffset: 12,
          payloadType: 0,
          sequenceNumber: this.sequenceNumber,
          timestamp: this.timestamp,
          ssrc: this.ssrc,
          csrcLength: 0,
          csrc: [],
          extensionProfile: 48862,
          extensionLength: undefined,
          extensions: [],
        }),
        temp,
      );
      this.callSession.send(rtpPacket.serialize());
      this.sequenceNumber += 1;
      this.timestamp += 160; // inbound audio use this time interval, in my opinion, it should be 20
      setTimeout(() => this.sendPacket(), 20);
    }
  }
}

export default Streamer;
