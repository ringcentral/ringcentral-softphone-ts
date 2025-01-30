import dgram from "node:dgram";
import EventEmitter from "node:events";
import { Buffer } from "node:buffer";

import { RtpHeader, RtpPacket, SrtpSession } from "werift-rtp";

import DTMF from "../dtmf.js";
import {
  type InboundMessage,
  RequestMessage,
  ResponseMessage,
} from "../sip-message/index.js";
import type Softphone from "../index.js";
import { branch, localKey, randomInt } from "../utils.js";
import Streamer from "./streamer.js";

abstract class CallSession extends EventEmitter {
  public softphone: Softphone;
  public sipMessage: InboundMessage;
  public socket: dgram.Socket;
  public localPeer: string;
  public remotePeer: string;
  public remoteIP: string;
  public remotePort: number;
  public disposed = false;
  public srtpSession: SrtpSession;
  public encoder: { encode: (pcm: Buffer) => Buffer };
  public decoder: { decode: (audio: Buffer) => Buffer };

  // for audio streaming
  public ssrc = randomInt();
  public sequenceNumber = randomInt();
  public timestamp = randomInt();

  public constructor(softphone: Softphone, sipMessage: InboundMessage) {
    super();
    this.softphone = softphone;
    this.encoder = softphone.codec.createEncoder();
    this.decoder = softphone.codec.createDecoder();
    this.sipMessage = sipMessage;
    this.remoteIP = this.sipMessage.body.match(/c=IN IP4 ([\d.]+)/)![1];
    this.remotePort = parseInt(
      this.sipMessage.body.match(/m=audio (\d+) /)![1],
      10,
    );
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

  public get callId() {
    return this.sipMessage.headers["Call-ID"];
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

  public sendDTMF(
    char: "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "*" | "#",
  ) {
    const timestamp = Math.floor(Date.now() / 1000);
    let sequenceNumber = timestamp % 65536;
    const rtpHeader = new RtpHeader({
      version: 2,
      padding: false,
      paddingSize: 0,
      extension: false,
      marker: false,
      payloadOffset: 12,
      payloadType: 101,
      sequenceNumber,
      timestamp,
      ssrc: randomInt(),
      csrcLength: 0,
      csrc: [],
      extensionProfile: 48862,
      extensionLength: undefined,
      extensions: [],
    });
    for (const payload of DTMF.charToPayloads(char)) {
      rtpHeader.sequenceNumber = sequenceNumber++;
      const rtpPacket = new RtpPacket(rtpHeader, payload);
      this.send(this.srtpSession.encrypt(rtpPacket.payload, rtpPacket.header));
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
      if (rtpPacket.header.payloadType === 101) {
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
          // we ignore it since DTMF is handled by `if (rtpPacket.header.payloadType === 101) {`
          return; // ignore it
        }
        try {
          rtpPacket.payload = this.decoder.decode(rtpPacket.payload);
          this.emit("audioPacket", rtpPacket);
        } catch {
          console.error("opus decode failed", rtpPacket);
        }
      }
    });

    // as I tested, we can use a random port here and it still works
    // but it seems that in SDP we need to tell remote our local IP Address, not 127.0.0.1
    this.socket.bind(); // random port
    // send a message to remote server so that it knows where to reply
    this.send("hello");

    const byeHandler = (inboundMessage: InboundMessage) => {
      if (inboundMessage.headers["Call-ID"] !== this.callId) {
        return;
      }
      if (inboundMessage.headers.CSeq.endsWith(" BYE")) {
        this.softphone.off("message", byeHandler);
        this.dispose();
      }
    };
    this.softphone.on("message", byeHandler);
  }

  protected dispose() {
    this.disposed = true;
    this.emit("disposed");
    this.removeAllListeners();
    this.socket?.removeAllListeners();
    this.socket?.close();
  }

  public transfer(transferTo: string) {
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
    this.softphone.send(requestMessage);
    // reply to those NOTIFY messages
    const notifyHandler = (inboundMessage: InboundMessage) => {
      if (!inboundMessage.subject.startsWith("NOTIFY ")) {
        return;
      }
      const responseMessage = new ResponseMessage(inboundMessage, 200);
      this.softphone.send(responseMessage);
      if (inboundMessage.body.trim() === "SIP/2.0 200 OK") {
        this.softphone.off("message", notifyHandler);
      }
    };
    this.softphone.on("message", notifyHandler);
  }
}

export default CallSession;
