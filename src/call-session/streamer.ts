import EventEmitter from 'events';

import { RtpHeader, RtpPacket } from 'werift-rtp';

import type CallSession from '.';
import { opus } from '../codec';
import { randomInt } from '../utils';

class Streamer extends EventEmitter {
  public paused = false;
  private callSession: CallSession;
  private buffer: Buffer;
  private originalBuffer: Buffer;
  private sequenceNumber = randomInt();
  private timestamp = randomInt();
  private ssrc = randomInt();
  private payloadType: number;

  public constructor(callSesstion: CallSession, buffer: Buffer, payloadType: number = 0) {
    super();
    this.callSession = callSesstion;
    this.buffer = buffer;
    this.originalBuffer = buffer;
    this.payloadType = payloadType;
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
    return this.buffer.length < 640;
  }

  private sendPacket() {
    if (!this.callSession.disposed && !this.paused && !this.finished) {
      
//       const temp = opus.encode(this.buffer.subarray(0, 640));
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
          payloadType: this.payloadType,
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
      this.callSession.send(
        this.callSession.srtpSession.encrypt(
          rtpPacket.payload,
          rtpPacket.header,
        ),
      );
      this.sequenceNumber += 1;
      if (this.sequenceNumber > 65535) {
        this.sequenceNumber = 0;
      }
//       this.timestamp += 320;
      this.timestamp += 160;
//       this.buffer = this.buffer.subarray(640);
      if (this.finished) {
        this.emit('finished');
      } else {
        setTimeout(() => this.sendPacket(), 20);
      }
    }
  }
}

export default Streamer;
