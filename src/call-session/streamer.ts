import { RtpHeader, RtpPacket } from 'werift-rtp';

import type CallSession from '.';
import { randomInt } from '../utils';

class Streamer {
  private callSession: CallSession;
  private buffer: Buffer;
  private originalBuffer: Buffer;
  private paused = false;
  private finished = false;
  private sequenceNumber = randomInt();
  private timestamp = randomInt();
  private ssrc = randomInt();

  public constructor(callSesstion: CallSession, buffer: Buffer) {
    this.callSession = callSesstion;
    this.buffer = buffer;
    this.originalBuffer = buffer;
  }

  public async start() {
    this.finished = false;
    this.buffer = this.originalBuffer;
    this.paused = false;
    this.sendPacket();
  }

  public async stop() {
    this.finished = true;
  }

  public async pause() {
    this.paused = true;
  }

  public async resume() {
    this.paused = false;
    this.sendPacket();
  }

  private sendPacket() {
    if (!this.callSession.disposed && !this.finished && !this.paused && this.buffer.length >= 160) {
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
