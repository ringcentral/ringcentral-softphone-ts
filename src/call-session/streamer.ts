import EventEmitter from "node:events";
import { Buffer } from "node:buffer";

import { RtpHeader, RtpPacket } from "werift-rtp";

import type CallSession from "./index.js";

class Streamer extends EventEmitter {
  public paused = false;
  private callSession: CallSession;
  private buffer: Buffer;
  private originalBuffer: Buffer;

  public constructor(callSesstion: CallSession, buffer: Buffer) {
    super();
    this.callSession = callSesstion;
    this.buffer = buffer;
    this.originalBuffer = buffer;
  }

  public start() {
    this.buffer = this.originalBuffer;
    this.paused = false;
    this.sendPacket();
  }

  public stop() {
    this.buffer = Buffer.alloc(0);
  }

  public pause() {
    this.paused = true;
  }

  public resume() {
    this.paused = false;
    this.sendPacket();
  }

  public get finished() {
    return this.buffer.length < this.callSession.softphone.codec.packetSize;
  }

  private sendPacket() {
    if (!this.callSession.disposed && !this.paused && !this.finished) {
      const temp = this.callSession.encoder.encode(
        this.buffer.subarray(0, this.callSession.softphone.codec.packetSize),
      );
      const rtpPacket = new RtpPacket(
        new RtpHeader({
          version: 2,
          padding: false,
          paddingSize: 0,
          extension: false,
          marker: false,
          payloadOffset: 12,
          payloadType: this.callSession.softphone.codec.id,
          sequenceNumber: this.callSession.sequenceNumber,
          timestamp: this.callSession.timestamp,
          ssrc: this.callSession.ssrc,
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
      this.callSession.sequenceNumber += 1;
      if (this.callSession.sequenceNumber > 65535) {
        this.callSession.sequenceNumber = 0;
      }
      this.callSession.timestamp +=
        this.callSession.softphone.codec.timestampInterval;
      this.buffer = this.buffer.subarray(
        this.callSession.softphone.codec.packetSize,
      );
      if (this.finished) {
        this.emit("finished");
      } else {
        setTimeout(() => this.sendPacket(), 20);
      }
    }
  }
}

export default Streamer;
