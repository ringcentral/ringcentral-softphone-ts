import { Buffer } from "node:buffer";
import EventEmitter from "node:events";

import { RtpHeader } from "werift-rtp";

import type { StreamerEventMap } from "../types.js";
import type CallSession from "./index.js";

class Streamer extends EventEmitter<StreamerEventMap> {
  public paused = false;
  private callSession: CallSession;
  private buffer: Buffer;
  private originalBuffer: Buffer;
  private timeout?: ReturnType<typeof setTimeout>;

  public constructor(callSession: CallSession, buffer: Buffer) {
    super();
    this.callSession = callSession;
    this.buffer = buffer;
    this.originalBuffer = buffer;
  }

  public start() {
    this.cancelTimeout();
    if (this.callSession.disposed) {
      return;
    }
    this.buffer = this.originalBuffer;
    this.paused = false;
    this.schedulePacket();
  }

  public stop() {
    this.cancelTimeout();
    this.paused = false;
    this.buffer = Buffer.alloc(0);
  }

  public pause() {
    if (this.timeout === undefined) {
      return;
    }
    this.paused = true;
    this.cancelTimeout();
  }

  public resume() {
    if (!this.paused || this.callSession.disposed) {
      return;
    }
    this.paused = false;
    this.schedulePacket();
  }

  public get finished() {
    return (
      this.callSession.disposed ||
      this.buffer.length < this.callSession.softphone.codec.packetSize
    );
  }

  private cancelTimeout() {
    clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private schedulePacket(delay = 0) {
    this.timeout = setTimeout(() => {
      this.timeout = undefined;
      this.sendPacket();
    }, delay);
  }

  private sendPacket() {
    const { callSession } = this;
    if (this.paused || callSession.disposed) {
      return;
    }
    const { codec } = callSession.softphone;
    if (this.finished) {
      this.emit("finished");
      return;
    }

    const payload = callSession.encoder.encode(
      this.buffer.subarray(0, codec.packetSize),
    );
    const header = new RtpHeader({
      payloadType: codec.id,
      sequenceNumber: callSession.sequenceNumber,
      timestamp: callSession.timestamp,
      ssrc: callSession.ssrc,
    });
    callSession.send(callSession.srtpSession.encrypt(payload, header));
    callSession.sequenceNumber += 1;
    if (callSession.sequenceNumber > 65535) {
      callSession.sequenceNumber = 0;
    }
    callSession.timestamp += codec.timestampInterval;
    this.buffer = this.buffer.subarray(codec.packetSize);
    if (callSession.disposed) {
      return;
    }
    if (this.finished) {
      this.emit("finished");
    } else {
      this.schedulePacket(20);
    }
  }
}

export default Streamer;
