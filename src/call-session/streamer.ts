import EventEmitter from "node:events";
import { Buffer } from "node:buffer";

import { RtpHeader, RtpPacket } from "werift-rtp";

import {
  AUDIO_PACKET_INTERVAL_MS,
  RTP_EXTENSION_PROFILE,
} from "../constants.js";
import type { CallSession } from "./index.js";

export class Streamer extends EventEmitter {
  public paused = false;
  private callSession: CallSession;
  private buffer: Buffer;
  private originalBuffer: Buffer;

  public constructor(callSession: CallSession, buffer: Buffer) {
    super();
    this.callSession = callSession;
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
          extensionProfile: RTP_EXTENSION_PROFILE,
          extensionLength: undefined,
          extensions: [],
        }),
        temp,
      );
      this.callSession.sendPacket(rtpPacket);
      this.callSession.incrementSequenceNumber();
      this.callSession.incrementTimestamp(
        this.callSession.softphone.codec.timestampInterval,
      );
      this.buffer = this.buffer.subarray(
        this.callSession.softphone.codec.packetSize,
      );
      if (this.finished) {
        this.emit("finished");
      } else {
        setTimeout(() => this.sendPacket(), AUDIO_PACKET_INTERVAL_MS);
      }
    }
  }
}

