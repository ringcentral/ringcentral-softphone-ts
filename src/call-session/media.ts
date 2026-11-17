import { randomInt } from "node:crypto";
import dgram from "node:dgram";
import EventEmitter, { once } from "node:events";
import { isIPv4 } from "node:net";

import type Codec from "../codec.js";
import * as DTMF from "../dtmf.js";
import { type RtpHeader, type RtpPacket, SrtpSession } from "../rtp/index.js";
import type { DtmfChar, StreamerEventMap } from "../types.js";
import { localKey } from "../utils.js";

const isAudioDtmfPayload = (payload: Buffer) =>
  payload.length === 4 &&
  payload[0] < DTMF.phoneChars.length &&
  payload.readUIntBE(1, 3) === 0x8a03c0;

type MediaEventMap = {
  rtpPacket: RtpPacket;
  dtmfPacket: RtpPacket;
  dtmf: DtmfChar;
  audioPacket: RtpPacket;
  audio: Buffer;
};

type EmitMediaEvent = <Event extends keyof MediaEventMap>(
  event: Event,
  value: MediaEventMap[Event],
) => void;

const parseSdp = (sdp: string) => {
  const remoteIP = sdp.match(/c=IN IP4 ([\d.]+)/)?.[1];
  const remotePort = Number(sdp.match(/m=audio (\d+) /)?.[1]);
  const remoteKey = sdp.match(/AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/)?.[1];
  if (!remoteIP || !remotePort || !remoteKey) {
    throw new Error(
      "Failed to start media: negotiated SDP did not contain a remote IP, audio port, and SRTP key",
    );
  }
  return { remoteIP, remotePort, remoteKey };
};

// Only the existing single audio stream and fixed codec/SRTP format can be updated.
const parseMediaUpdate = (sdp: string, codec: Codec) => {
  const lines = sdp
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const mediaIndex = lines.findIndex((line) => line.startsWith("m="));
  const session = lines.slice(0, mediaIndex);
  const media = lines.slice(mediaIndex);
  const audio = media[0]?.match(
    /^m=audio\s+(\d+)\s+RTP\/SAVP\s+(\d+(?:\s+\d+)*)$/,
  );
  const scoped = (prefix: string) => {
    const local = media.filter((line) => line.startsWith(prefix));
    return local.length
      ? local
      : session.filter((line) => line.startsWith(prefix));
  };
  const connections = scoped("c=");
  const remoteIP = connections[0]?.match(/^c=IN\s+IP4\s+(\S+)$/)?.[1];
  const remotePort = Number(audio?.[1]);
  const mappings = media.filter((line) =>
    new RegExp(`^a=rtpmap:${codec.id}(?:\\s|$)`).test(line),
  );
  const mapping = mappings[0]?.split(/\s+/).slice(1).join(" ").toUpperCase();
  const crypto = scoped("a=crypto:");
  const remoteKey = crypto[0]?.match(
    /^a=crypto:\d+\s+AES_CM_128_HMAC_SHA1_80\s+inline:([A-Za-z0-9+/]+={0,2})$/,
  )?.[1];
  const directionIn = (scope: string[]) =>
    scope.filter((line) =>
      /^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line),
    );
  const mediaDirections = directionIn(media);
  const directions = mediaDirections.length
    ? mediaDirections
    : directionIn(session);
  if (
    !audio ||
    media.filter((line) => line.startsWith("m=")).length !== 1 ||
    !audio[2].split(/\s+/).includes(String(codec.id)) ||
    mappings.length > 1 ||
    (mappings.length
      ? mapping?.replace(/\/1$/, "") !== codec.name
      : codec.id !== 0) ||
    connections.length !== 1 ||
    !remoteIP ||
    !isIPv4(remoteIP) ||
    remoteIP === "0.0.0.0" ||
    remotePort < 1 ||
    remotePort > 65535 ||
    crypto.length !== 1 ||
    !remoteKey ||
    Buffer.from(remoteKey, "base64").length !== 30 ||
    directions.length > 1
  ) {
    throw new Error("Unsupported remote media offer");
  }
  return {
    remoteIP,
    remotePort,
    remoteKey,
    direction: directions[0] ?? "a=sendrecv",
  };
};

export class MediaTransport {
  public readonly localPort: number;

  private socket: dgram.Socket;
  private codec: Codec;
  private encoder: { encode: (pcm: Buffer) => Buffer };
  private decoder: { decode: (audio: Buffer) => Buffer };
  private remoteIP?: string;
  private remotePort?: number;
  private srtpSession?: SrtpSession;
  private sequenceNumber = randomInt(2 ** 16);
  private timestamp = randomInt(2 ** 32);
  private ssrc = randomInt(2 ** 32);
  private started = false;
  private remoteSdp = "";
  private remoteKey?: string;
  private disposedState = false;

  private constructor(codec: Codec, socket: dgram.Socket, localPort: number) {
    this.codec = codec;
    this.socket = socket;
    this.localPort = localPort;
    this.encoder = codec.createEncoder();
    this.decoder = codec.createDecoder();
  }

  public static async bind(codec: Codec) {
    const socket = dgram.createSocket("udp4");
    try {
      const listening = once(socket, "listening");
      socket.bind(0);
      await listening;
      return new MediaTransport(codec, socket, socket.address().port);
    } catch (error) {
      socket.close();
      throw error;
    }
  }

  public get packetSize() {
    return this.codec.packetSize;
  }

  public get disposed() {
    return this.disposedState;
  }

  public start(sdp: string, emit: EmitMediaEvent) {
    if (this.started) {
      throw new Error("Media transport has already started");
    }
    if (this.disposed) {
      throw new Error("Media transport is disposed");
    }

    try {
      const { remoteIP, remotePort, remoteKey } = parseSdp(sdp);
      const localKeyBuffer = Buffer.from(localKey, "base64");
      const remoteKeyBuffer = Buffer.from(remoteKey, "base64");
      this.remoteIP = remoteIP;
      this.remotePort = remotePort;
      this.srtpSession = new SrtpSession(localKeyBuffer, remoteKeyBuffer);
      this.started = true;
      this.remoteSdp = sdp;
      this.remoteKey = remoteKey;
      this.socket.on("message", (message) => {
        const packet = this.srtpSession!.decrypt(message);
        if (!packet) {
          return;
        }
        emit("rtpPacket", packet);
        if (packet.header.payloadType === 101) {
          emit("dtmfPacket", packet);
          const char = DTMF.payloadToChar(packet.payload);
          if (char) {
            emit("dtmf", char);
          }
        } else if (packet.header.payloadType === this.codec.id) {
          if (isAudioDtmfPayload(packet.payload)) {
            return; // DTMF is handled through RTP payload type 101
          }
          try {
            packet.payload = this.decoder.decode(packet.payload);
            emit("audioPacket", packet);
            emit("audio", packet.payload);
          } catch {
            console.error("Audio packet decode failed", packet);
          }
        }
      });
      this.send("hello");
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  public updateDestination(sdp: string): boolean {
    try {
      if (!this.started || this.disposed) {
        return false;
      }
      const offer = parseMediaUpdate(sdp, this.codec);
      const current = parseMediaUpdate(this.remoteSdp, this.codec);
      if (
        offer.remoteKey !== this.remoteKey ||
        offer.direction !== current.direction
      ) {
        return false;
      }
      this.remoteIP = offer.remoteIP;
      this.remotePort = offer.remotePort;
      return true;
    } catch {
      return false;
    }
  }

  public sendDTMF(char: DtmfChar) {
    if (!this.ready()) {
      return;
    }
    const timestamp = this.timestamp;
    for (const [index, payload] of DTMF.charToPayloads(char).entries()) {
      const header: RtpHeader = {
        marker: index === 0,
        payloadType: 101,
        sequenceNumber: this.sequenceNumber,
        timestamp,
        ssrc: this.ssrc,
      };
      this.send(this.srtpSession!.encrypt(payload, header));
      this.sequenceNumber = (this.sequenceNumber + 1) % 65536;
    }
    this.timestamp = (this.timestamp + 800) % 2 ** 32;
  }

  public streamAudio(input: Buffer) {
    if (!this.disposed) {
      this.requireStarted();
    }
    const streamer = new Streamer(this, input);
    streamer.start();
    return streamer;
  }

  public sendPacket(packet: RtpPacket) {
    if (this.ready()) {
      this.send(this.srtpSession!.encrypt(packet.payload, packet.header));
    }
  }

  public sendAudio(pcm: Buffer) {
    if (!this.ready()) {
      return;
    }
    const payload = this.encoder.encode(pcm);
    const header: RtpHeader = {
      marker: false,
      payloadType: this.codec.id,
      sequenceNumber: this.sequenceNumber,
      timestamp: this.timestamp,
      ssrc: this.ssrc,
    };
    this.send(this.srtpSession!.encrypt(payload, header));
    this.sequenceNumber = (this.sequenceNumber + 1) % 65536;
    this.timestamp = (this.timestamp + this.codec.timestampInterval) % 2 ** 32;
  }

  public dispose() {
    if (this.disposed) {
      return false;
    }
    this.disposedState = true;
    this.socket.removeAllListeners();
    this.socket.close();
    return true;
  }

  private requireStarted() {
    if (!this.started) {
      throw new Error("Media transport has not started");
    }
  }

  private ready() {
    if (this.disposed) {
      return false;
    }
    this.requireStarted();
    return true;
  }

  private send(data: string | Buffer) {
    this.socket.send(data, this.remotePort!, this.remoteIP!);
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
