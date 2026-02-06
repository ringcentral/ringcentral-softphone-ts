import dgram from "node:dgram";
import EventEmitter from "node:events";
import { Buffer } from "node:buffer";

import { RtpHeader, RtpPacket, SrtpSession } from "werift-rtp";

import DTMF, { type DTMFChar, isDTMFChar } from "../dtmf.js";
import {
  DTMF_DEFAULT_DELAY_MS,
  DTMF_PAYLOAD_TYPE,
  DTMF_TIMESTAMP_INCREMENT,
  RTP_EXTENSION_PROFILE,
  RTP_SEQUENCE_NUMBER_MAX,
  SRTP_PROFILE_AES_CM_128_HMAC_SHA1_80,
} from "../constants.js";
import {
  type InboundMessage,
  RequestMessage,
  ResponseMessage,
} from "../sip-message/index.js";
import type Softphone from "../index.js";
import { branch, extractAddress, localKey, randomInt } from "../utils.js";
import Streamer from "./streamer.js";
import waitFor from "wait-for-async";

abstract class CallSession extends EventEmitter {
  public readonly softphone: Softphone;
  public readonly sipMessage: InboundMessage;
  public readonly encoder: { encode: (pcm: Buffer) => Buffer };
  public readonly decoder: { decode: (audio: Buffer) => Buffer };

  // for audio streaming
  public readonly ssrc = randomInt();

  public sdp!: string;

  protected socket!: dgram.Socket;
  protected localPeer!: string;
  protected remotePeer!: string;
  protected remoteIP!: string;
  protected remotePort!: number;
  protected srtpSession!: SrtpSession;

  private _disposed = false;
  private _sequenceNumber = randomInt();
  private _timestamp = randomInt();

  public get disposed() {
    return this._disposed;
  }

  public get sequenceNumber() {
    return this._sequenceNumber;
  }

  public get timestamp() {
    return this._timestamp;
  }

  public incrementSequenceNumber() {
    this._sequenceNumber = (this._sequenceNumber + 1) % RTP_SEQUENCE_NUMBER_MAX;
    return this._sequenceNumber;
  }

  public incrementTimestamp(interval: number) {
    this._timestamp += interval;
    return this._timestamp;
  }

  public constructor(softphone: Softphone, sipMessage: InboundMessage) {
    super();
    this.softphone = softphone;
    this.encoder = softphone.codec.createEncoder();
    this.decoder = softphone.codec.createDecoder();
    this.sipMessage = sipMessage;
    // inbound call from call queue, invite message may not have body
    if (this.sipMessage.body.length > 0) {
      const ipMatch = this.sipMessage.body.match(/c=IN IP4 ([\d.]+)/);
      if (!ipMatch) {
        throw new Error(
          "SIP message error: missing connection line (c=IN IP4) in SDP body",
        );
      }
      this.remoteIP = ipMatch[1];
      const portMatch = this.sipMessage.body.match(/m=audio (\d+) /);
      if (!portMatch) {
        throw new Error(
          "SIP message error: missing media line (m=audio) in SDP body",
        );
      }
      this.remotePort = parseInt(portMatch[1], 10);
    }
  }

  public set remoteKey(key: string) {
    const localKeyBuffer = Buffer.from(localKey, "base64");
    const remoteKeyBuffer = Buffer.from(key, "base64");
    this.srtpSession = new SrtpSession({
      profile: SRTP_PROFILE_AES_CM_128_HMAC_SHA1_80,
      keys: {
        localMasterKey: localKeyBuffer.subarray(0, 16),
        localMasterSalt: localKeyBuffer.subarray(16, 30),
        remoteMasterKey: remoteKeyBuffer.subarray(0, 16),
        remoteMasterSalt: remoteKeyBuffer.subarray(16, 30),
      },
    });
  }

  public get callId() {
    return this.sipMessage.getHeader("Call-ID");
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
  }

  public sendDTMF(char: DTMFChar) {
    const payloads = DTMF.charToPayloads(char);
    const timestamp = this.timestamp;
    let first = true;
    for (const payload of payloads) {
      const rtpHeader = new RtpHeader({
        version: 2,
        padding: false,
        paddingSize: 0,
        extension: false,
        marker: first,
        payloadOffset: 12,
        payloadType: DTMF_PAYLOAD_TYPE,
        sequenceNumber: this.sequenceNumber,
        timestamp,
        ssrc: this.ssrc,
        csrcLength: 0,
        csrc: [],
        extensionProfile: RTP_EXTENSION_PROFILE,
        extensionLength: undefined,
        extensions: [],
      });
      const rtpPacket = new RtpPacket(rtpHeader, payload);
      this.sendPacket(rtpPacket);
      this.incrementSequenceNumber();
      first = false;
    }
    this.incrementTimestamp(DTMF_TIMESTAMP_INCREMENT);
  }

  public async sendDTMFs(s: string, delay = DTMF_DEFAULT_DELAY_MS) {
    for (const c of s) {
      if (!isDTMFChar(c)) {
        throw new Error(
          `Invalid DTMF character: "${c}". Valid characters are 0-9, *, #`,
        );
      }
      this.sendDTMF(c);
      await waitFor({ interval: delay });
    }
  }

  // buffer is the content of a audio file, it is supposed to be uncompressed PCM data
  // The audio should be playable by command: play -t raw -b 16 -r 16000 -e signed-integer test.wav
  public streamAudio(input: Buffer) {
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
    this.socket = dgram.createSocket("udp4");
    this.socket.on("message", (message) => {
      const rtpPacket = RtpPacket.deSerialize(
        this.srtpSession.decrypt(message),
      );
      this.emit("rtpPacket", rtpPacket);
      if (rtpPacket.header.payloadType === DTMF_PAYLOAD_TYPE) {
        this.emit("dtmfPacket", rtpPacket);
        const char = DTMF.payloadToChar(rtpPacket.payload);
        if (char) {
          this.emit("dtmf", char);
        }
      } else if (rtpPacket.header.payloadType === this.softphone.codec.id) {
        if (
          rtpPacket.payload.length === 4 &&
          rtpPacket.payload[0] >= 0x00 &&
          rtpPacket.payload[0] < 0x0c &&
          rtpPacket.payload[1] === 0x8a &&
          rtpPacket.payload[2] === 0x03 &&
          rtpPacket.payload[3] === 0xc0
        ) {
          // special DTMF packet in audio format
          // first byte 0x00 to 0x0c means DTMF 0 to 9, *, #
          // we ignore it since DTMF is handled by the DTMF_PAYLOAD_TYPE check above
          return; // ignore it
        }
        try {
          rtpPacket.payload = this.decoder.decode(rtpPacket.payload);
          this.emit("audioPacket", rtpPacket);
        } catch {
          console.error("Audio packet decode failed", rtpPacket);
        }
      }
    });

    // as I tested, we can use a random port here and it still works
    // but it seems that in SDP we need to tell remote our local IP Address, not 127.0.0.1
    this.socket.bind(); // random port
    // send a message to remote server so that it knows where to reply
    this.send("hello");

    const byeHandler = (inboundMessage: InboundMessage) => {
      if (inboundMessage.getHeader("Call-ID") !== this.callId) {
        return;
      }
      if (inboundMessage.headers.CSeq.endsWith(" BYE")) {
        cleanup();
      }
    };

    const revokedHandler = () => {
      cleanup();
    };

    const cleanup = () => {
      this.softphone.off("message", byeHandler);
      this.softphone.off("revoked", revokedHandler);
      this.dispose();
    };

    this.softphone.on("message", byeHandler);
    this.softphone.on("revoked", revokedHandler);
  }

  protected dispose() {
    this._disposed = true;
    this.emit("disposed");
    this.removeAllListeners();
    this.socket?.removeAllListeners();
    this.socket?.close();
  }

  public async transfer(transferTo: string) {
    const requestMessage = new RequestMessage(
      `REFER sip:${this.softphone.sipInfo.username}@${this.softphone.sipInfo.outboundProxy};transport=tls SIP/2.0`,
      {
        Via:
          `SIP/2.0/TLS ${this.softphone.client.localAddress}:${this.softphone.client.localPort};rport;branch=${branch()};alias`,
        "Max-Forwards": 70,
        From: this.localPeer,
        To: this.remotePeer,
        Contact:
          `<sip:${this.softphone.sipInfo.username}@${this.softphone.client.localAddress}:${this.softphone.client.localPort};transport=TLS;ob>`,
        "Call-ID": this.callId,
        Event: "refer",
        Expires: 600,
        Supported: "replaces, 100rel, timer, norefersub",
        Accept: "message/sipfrag;version=2.0",
        "Allow-Events": "presence, message-summary, refer",
        "Refer-To": `sip:${transferTo}@${this.softphone.sipInfo.domain}`,
        "Referred-By":
          `<sip:${this.softphone.sipInfo.username}@${this.softphone.sipInfo.domain}>`,
      },
    );
    await this.softphone.send(requestMessage);

    return new Promise<void>((resolve, reject) => {
      const notifyHandler = (inboundMessage: InboundMessage) => {
        if (!inboundMessage.subject.startsWith("NOTIFY ")) {
          return;
        }
        const responseMessage = new ResponseMessage(inboundMessage, 200);
        this.softphone.send(responseMessage);
        if (inboundMessage.body.trim() === "SIP/2.0 200 OK") {
          cleanupNotifyHandler();
          resolve();
        }
      };

      const revokedHandler = () => {
        cleanupNotifyHandler();
        reject(new Error("Transfer failed: softphone was revoked"));
      };

      const cleanupNotifyHandler = () => {
        this.softphone.off("message", notifyHandler);
        this.softphone.off("revoked", revokedHandler);
      };

      this.softphone.on("message", notifyHandler);
      this.softphone.on("revoked", revokedHandler);
    });
  }

  public async toggleReceive(toReceive: boolean) {
    let newSDP = this.sdp;
    if (!toReceive) {
      newSDP = newSDP.replace(/a=sendrecv/, "a=sendonly");
    }
    const requestMessage = new RequestMessage(
      `INVITE ${extractAddress(this.remotePeer)} SIP/2.0`,
      {
        "Call-Id": this.callId,
        From: this.localPeer,
        To: this.remotePeer,
        Via:
          `SIP/2.0/TLS ${this.softphone.client.localAddress}:${this.softphone.client.localPort};rport;branch=${branch()};alias`,
        "Content-Type": "application/sdp",
        Contact:
          ` <sip:${this.softphone.sipInfo.username}@${this.softphone.client.localAddress}:${this.softphone.client.localPort};transport=TLS;ob>`,
      },
      newSDP,
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
