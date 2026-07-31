import { randomInt } from "node:crypto";
import dgram from "node:dgram";
import EventEmitter, { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { RtpHeader, RtpPacket, SrtpSession } from "werift-rtp";
import * as DTMF from "../dtmf.js";
import type Softphone from "../index.js";
import {
  type InboundMessage,
  RequestMessage,
  ResponseMessage,
} from "../sip-message.js";
import type {
  DtmfChar,
  OutboundCallSessionEventMap,
  Streamer as PublicStreamer,
} from "../types.js";
import { branch, extractAddress, localKey } from "../utils.js";
import Streamer from "./streamer.js";

const isDtmfChar = (value: string): value is DtmfChar =>
  (DTMF.phoneChars as readonly string[]).includes(value);

const isAudioDtmfPayload = (payload: Buffer) =>
  payload.length === 4 &&
  payload[0] < DTMF.phoneChars.length &&
  payload.readUIntBE(1, 3) === 0x8a03c0;

export const requireCallId = (message: InboundMessage): string => {
  const callId = message.getHeader("Call-ID")?.trim();
  if (!callId) {
    throw new Error("Cannot create call session without a Call-ID header");
  }
  return callId;
};

abstract class CallSession extends EventEmitter<OutboundCallSessionEventMap> {
  public softphone: Softphone;
  public sipMessage: InboundMessage;
  public socket!: dgram.Socket;
  public localPeer!: string;
  public remotePeer!: string;
  public remoteIP!: string;
  public remotePort!: number;
  public disposed = false;
  public srtpSession!: SrtpSession;
  public encoder: { encode: (pcm: Buffer) => Buffer };
  public decoder: { decode: (audio: Buffer) => Buffer };
  public sdp!: string;
  public readonly callId: string;

  // for audio streaming
  public sequenceNumber = randomInt(2 ** 16);
  public timestamp = randomInt(2 ** 32);
  public ssrc = randomInt(2 ** 32);

  private byeHandler?: (message: InboundMessage) => void;

  public constructor(softphone: Softphone, sipMessage: InboundMessage) {
    super();
    this.softphone = softphone;
    this.encoder = softphone.codec.createEncoder();
    this.decoder = softphone.codec.createDecoder();
    this.sipMessage = sipMessage;
    this.callId = requireCallId(sipMessage);

    // inbound call from call queue, invite message may not have body
    if (this.sipMessage.body.length > 0) {
      this.remoteIP = this.sipMessage.body.match(/c=IN IP4 ([\d.]+)/)![1];
      this.remotePort = parseInt(
        this.sipMessage.body.match(/m=audio (\d+) /)![1],
        10,
      );
    }
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

  public send(data: string | Buffer) {
    this.socket.send(data, this.remotePort, this.remoteIP);
  }

  public async hangup() {
    const requestMessage = new RequestMessage(
      `BYE sip:${this.softphone.sipInfo.domain} SIP/2.0`,
      {
        "Call-ID": this.callId,
        From: this.localPeer,
        To: this.remotePeer,
        Via: `SIP/2.0/TLS ${this.softphone.fakeDomain};branch=${branch()}`,
      },
    );
    await this.softphone.send(requestMessage);
    this.dispose();
  }

  public sendDTMF(char: DtmfChar) {
    const timestamp = this.timestamp;
    for (const [index, payload] of DTMF.charToPayloads(char).entries()) {
      const rtpHeader = new RtpHeader({
        marker: index === 0,
        payloadType: 101,
        sequenceNumber: this.sequenceNumber,
        timestamp,
        ssrc: this.ssrc,
      });
      this.send(this.srtpSession.encrypt(payload, rtpHeader));
      this.sequenceNumber = (this.sequenceNumber + 1) % 65536;
    }
    this.timestamp += 800;
  }

  public async sendDTMFs(s: string, delay = 500) {
    for (const c of s) {
      if (!isDtmfChar(c)) {
        throw new Error(`invalid phone char: ${c}`);
      }
      this.sendDTMF(c);
      await sleep(delay);
    }
  }

  // buffer is the content of a audio file, it is supposed to be uncompressed PCM data
  // The audio should be playable by command: play -t raw -b 16 -r 16000 -e signed-integer test.wav
  public streamAudio(input: Buffer): PublicStreamer {
    const streamer = new Streamer(this, input);
    streamer.start();
    return streamer;
  }

  // send a single rtp packet
  public sendPacket(rtpPacket: RtpPacket) {
    if (this.disposed) {
      return;
    }
    this.send(this.srtpSession.encrypt(rtpPacket.payload, rtpPacket.header));
  }

  protected startLocalServices() {
    if (!this.socket) {
      throw new Error(
        "RTP socket is not initialized; expected pre-bound socket from SDP setup",
      );
    }
    this.socket.on("message", (message) => {
      const rtpPacket = RtpPacket.deSerialize(
        this.srtpSession.decrypt(message),
      );
      this.emit("rtpPacket", rtpPacket);
      if (rtpPacket.header.payloadType === 101) {
        this.emit("dtmfPacket", rtpPacket);
        const char = DTMF.payloadToChar(rtpPacket.payload);
        if (char) {
          this.emit("dtmf", char);
        }
      } else if (rtpPacket.header.payloadType === this.softphone.codec.id) {
        if (isAudioDtmfPayload(rtpPacket.payload)) {
          return; // DTMF is handled through RTP payload type 101
        }
        try {
          rtpPacket.payload = this.decoder.decode(rtpPacket.payload);
          this.emit("audioPacket", rtpPacket);
          this.emit("audio", rtpPacket.payload);
        } catch {
          console.error("Audio packet decode failed", rtpPacket);
        }
      }
    });

    // send a message to remote server so that it knows where to reply
    this.send("hello");

    this.byeHandler = (inboundMessage: InboundMessage) => {
      if (inboundMessage.getHeader("Call-ID") !== this.callId) {
        return;
      }
      if (inboundMessage.headers.CSeq.endsWith(" BYE")) {
        this.dispose();
      }
    };
    this.softphone.on("message", this.byeHandler);
  }

  protected dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.emit("disposed");
    this.removeAllListeners();
    if (this.byeHandler) {
      this.softphone.off("message", this.byeHandler);
      this.byeHandler = undefined;
    }
    this.socket?.removeAllListeners();
    this.socket?.close();
  }

  public async transfer(transferTo: string) {
    const requestMessage = new RequestMessage(
      `REFER sip:${this.softphone.sipInfo.username}@${this.softphone.sipInfo.outboundProxy};transport=tls SIP/2.0`,
      {
        Via: `SIP/2.0/TLS ${this.softphone.client.localAddress}:${this.softphone.client.localPort};rport;branch=${branch()};alias`,
        "Max-Forwards": 70,
        From: this.localPeer,
        To: this.remotePeer,
        Contact: `<sip:${this.softphone.sipInfo.username}@${this.softphone.client.localAddress}:${this.softphone.client.localPort};transport=TLS;ob>`,
        "Call-ID": this.callId,
        Event: "refer",
        Expires: 600,
        Supported: "replaces, 100rel, timer, norefersub",
        Accept: "message/sipfrag;version=2.0",
        "Allow-Events": "presence, message-summary, refer",
        "Refer-To": `sip:${transferTo}@${this.softphone.sipInfo.domain}`,
        "Referred-By": `<sip:${this.softphone.sipInfo.username}@${this.softphone.sipInfo.domain}>`,
      },
    );
    await this.softphone.send(requestMessage);

    return new Promise<void>((resolve) => {
      const notifyHandler = (inboundMessage: InboundMessage) => {
        if (!inboundMessage.subject.startsWith("NOTIFY ")) {
          return;
        }
        this.softphone.send(new ResponseMessage(inboundMessage, "200 OK"));
        if (inboundMessage.body.trim() === "SIP/2.0 200 OK") {
          this.softphone.off("message", notifyHandler);
          resolve();
        }
      };
      this.softphone.on("message", notifyHandler);
    });
  }

  public async toggleReceive(toReceive: boolean) {
    const requestMessage = new RequestMessage(
      `INVITE ${extractAddress(this.remotePeer)} SIP/2.0`,
      {
        "Call-Id": this.callId,
        From: this.localPeer,
        To: this.remotePeer,
        Via: `SIP/2.0/TLS ${this.softphone.client.localAddress}:${this.softphone.client.localPort};rport;branch=${branch()};alias`,
        "Content-Type": "application/sdp",
        Contact: ` <sip:${this.softphone.sipInfo.username}@${this.softphone.client.localAddress}:${this.softphone.client.localPort};transport=TLS;ob>`,
      },
      toReceive ? this.sdp : this.sdp.replace(/a=sendrecv/, "a=sendonly"),
    );
    const replyMessage = await this.softphone.send(requestMessage, true);
    const ackMessage = new RequestMessage(
      `ACK ${extractAddress(this.remotePeer)} SIP/2.0`,
      {
        "Call-Id": this.callId,
        From: this.localPeer,
        To: this.remotePeer,
        Via: replyMessage.headers.Via,
        CSeq: replyMessage.headers.CSeq.replace(" INVITE", " ACK"),
      },
    );
    await this.softphone.send(ackMessage);
  }

  public async hold() {
    return this.toggleReceive(false);
  }

  public async unhold() {
    return this.toggleReceive(true);
  }
}

export default CallSession;
