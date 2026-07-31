import { randomInt } from "node:crypto";
import dgram from "node:dgram";
import EventEmitter, { once } from "node:events";

import { RtpHeader, RtpPacket, SrtpSession } from "werift-rtp";

import type Codec from "../codec.js";
import * as DTMF from "../dtmf.js";
import type { DtmfChar, StreamerEventMap } from "../types.js";
import { localKey } from "../utils.js";

const isAudioDtmfPayload = (payload: Buffer) =>
  payload.length === 4 &&
  payload[0] < DTMF.phoneChars.length &&
  payload.readUIntBE(1, 3) === 0x8a03c0;

type EmitMediaEvent = (event: string, value: unknown) => void;

export class MediaTransport {
  public socket!: dgram.Socket;
  public remoteIP!: string;
  public remotePort!: number;
  public disposed = false;
  public srtpSession!: SrtpSession;
  public encoder: { encode: (pcm: Buffer) => Buffer };
  public decoder: { decode: (audio: Buffer) => Buffer };
  public sequenceNumber = randomInt(2 ** 16);
  public timestamp = randomInt(2 ** 32);
  public ssrc = randomInt(2 ** 32);

  private codec: Codec;
  private emit: EmitMediaEvent;

  public constructor(codec: Codec, emit: EmitMediaEvent) {
    this.codec = codec;
    this.emit = emit;
    this.encoder = codec.createEncoder();
    this.decoder = codec.createDecoder();
  }

  public static async createBoundSocket() {
    const socket = dgram.createSocket("udp4");
    try {
      const listening = once(socket, "listening");
      socket.bind(0);
      await listening;
      return { socket, port: socket.address().port };
    } catch (error) {
      socket.close();
      throw error;
    }
  }

  public get packetSize() {
    return this.codec.packetSize;
  }

  public set remoteKey(key: string) {
    const localKeyBuffer = Buffer.from(localKey, "base64");
    const remoteKeyBuffer = Buffer.from(key, "base64");
    this.srtpSession = new SrtpSession({
      profile: 0x0001,
      keys: {
        localMasterKey: localKeyBuffer.subarray(0, 16),
        localMasterSalt: localKeyBuffer.subarray(16, 30),
        remoteMasterKey: remoteKeyBuffer.subarray(0, 16),
        remoteMasterSalt: remoteKeyBuffer.subarray(16, 30),
      },
    });
  }

  public sendDTMF(char: DtmfChar) {
    const timestamp = this.timestamp;
    for (const [index, payload] of DTMF.charToPayloads(char).entries()) {
      const header = new RtpHeader({
        marker: index === 0,
        payloadType: 101,
        sequenceNumber: this.sequenceNumber,
        timestamp,
        ssrc: this.ssrc,
      });
      this.send(this.srtpSession.encrypt(payload, header));
      this.sequenceNumber = (this.sequenceNumber + 1) % 65536;
    }
    this.timestamp += 800;
  }

  public streamAudio(input: Buffer) {
    const streamer = new Streamer(this, input);
    streamer.start();
    return streamer;
  }

  public sendPacket(packet: RtpPacket) {
    if (!this.disposed) {
      this.send(this.srtpSession.encrypt(packet.payload, packet.header));
    }
  }

  public sendAudio(pcm: Buffer) {
    const payload = this.encoder.encode(pcm);
    const header = new RtpHeader({
      payloadType: this.codec.id,
      sequenceNumber: this.sequenceNumber,
      timestamp: this.timestamp,
      ssrc: this.ssrc,
    });
    this.send(this.srtpSession.encrypt(payload, header));
    this.sequenceNumber = (this.sequenceNumber + 1) % 65536;
    this.timestamp += this.codec.timestampInterval;
  }

  public start() {
    if (!this.socket) {
      throw new Error(
        "RTP socket is not initialized; expected pre-bound socket from SDP setup",
      );
    }
    this.socket.on("message", (message) => {
      const packet = RtpPacket.deSerialize(this.srtpSession.decrypt(message));
      this.emit("rtpPacket", packet);
      if (packet.header.payloadType === 101) {
        this.emit("dtmfPacket", packet);
        const char = DTMF.payloadToChar(packet.payload);
        if (char) {
          this.emit("dtmf", char);
        }
      } else if (packet.header.payloadType === this.codec.id) {
        if (isAudioDtmfPayload(packet.payload)) {
          return; // DTMF is handled through RTP payload type 101
        }
        try {
          packet.payload = this.decoder.decode(packet.payload);
          this.emit("audioPacket", packet);
          this.emit("audio", packet.payload);
        } catch {
          console.error("Audio packet decode failed", packet);
        }
      }
    });
    this.send("hello");
  }

  public close() {
    this.socket?.removeAllListeners();
    this.socket?.close();
  }

  private send(data: string | Buffer) {
    this.socket.send(data, this.remotePort, this.remoteIP);
  }
}

export class Streamer extends EventEmitter<StreamerEventMap> {
  public paused = false;
  private media: MediaTransport;
  private buffer: Buffer;
  private originalBuffer: Buffer;
  private timeout?: ReturnType<typeof setTimeout>;

  public constructor(media: MediaTransport, buffer: Buffer) {
    super();
    this.media = media;
    this.buffer = buffer;
    this.originalBuffer = buffer;
  }

  public start() {
    this.cancelTimeout();
    if (this.media.disposed) {
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
    if (!this.paused || this.media.disposed) {
      return;
    }
    this.paused = false;
    this.schedulePacket();
  }

  public get finished() {
    return this.media.disposed || this.buffer.length < this.media.packetSize;
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
    if (this.paused || this.media.disposed) {
      return;
    }
    if (this.finished) {
      this.emit("finished");
      return;
    }

    this.media.sendAudio(this.buffer.subarray(0, this.media.packetSize));
    this.buffer = this.buffer.subarray(this.media.packetSize);
    if (this.media.disposed) {
      return;
    }
    if (this.finished) {
      this.emit("finished");
    } else {
      this.schedulePacket(20);
    }
  }
}
