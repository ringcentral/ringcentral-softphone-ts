import EventEmitter from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import type { RtpPacket } from "werift-rtp";
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
import { branch, extractAddress } from "../utils.js";
import type { MediaTransport } from "./media.js";

const isDtmfChar = (value: string): value is DtmfChar =>
  (DTMF.phoneChars as readonly string[]).includes(value);

export const requireCallId = (message: InboundMessage): string => {
  if (message.callId === undefined) {
    throw new Error("Cannot create call session without a Call-ID header");
  }
  return message.callId;
};

abstract class CallSession extends EventEmitter<OutboundCallSessionEventMap> {
  public softphone: Softphone;
  public sipMessage: InboundMessage;
  public localPeer!: string;
  public remotePeer!: string;
  public media: MediaTransport;
  public sdp!: string;
  public readonly callId: string;

  private disposedState = false;
  private pendingTransfer?: {
    resolve: () => void;
    reject: (error: Error) => void;
  };

  public constructor(
    softphone: Softphone,
    sipMessage: InboundMessage,
    media: MediaTransport,
  ) {
    super();
    this.softphone = softphone;
    this.media = media;
    this.sipMessage = sipMessage;
    this.callId = requireCallId(sipMessage);
    this.softphone.signaling.on("message", this.signalingHandler);
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
    this.softphone.signaling.send(requestMessage);
    this.dispose();
  }

  public sendDTMF(char: DtmfChar) {
    this.media.sendDTMF(char);
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
    return this.media.streamAudio(input);
  }

  // send a single rtp packet
  public sendPacket(rtpPacket: RtpPacket) {
    this.media.sendPacket(rtpPacket);
  }

  protected startLocalServices(sdp: string) {
    this.media.start(sdp, (event, value) => this.emit(event as string, value));
  }

  protected dispose() {
    if (this.disposedState) {
      return;
    }
    this.disposedState = true;
    this.media.dispose();
    this.emit("disposed");
    this.removeAllListeners();
    this.softphone.signaling.off("message", this.signalingHandler);
    this.pendingTransfer?.reject(new Error("Call session was disposed"));
    this.pendingTransfer = undefined;
  }

  public async transfer(transferTo: string) {
    if (this.pendingTransfer) {
      throw new Error("A call transfer is already pending");
    }
    const requestMessage = new RequestMessage(
      `REFER sip:${this.softphone.sipInfo.username}@${this.softphone.sipInfo.outboundProxy};transport=tls SIP/2.0`,
      {
        Via: `SIP/2.0/TLS ${this.softphone.signaling.localAddress}:${this.softphone.signaling.localPort};rport;branch=${branch()};alias`,
        "Max-Forwards": 70,
        From: this.localPeer,
        To: this.remotePeer,
        Contact: `<sip:${this.softphone.sipInfo.username}@${this.softphone.signaling.localAddress}:${this.softphone.signaling.localPort};transport=TLS;ob>`,
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
    return new Promise<void>((resolve, reject) => {
      this.pendingTransfer = { resolve, reject };
      try {
        this.softphone.signaling.send(requestMessage);
      } catch (error) {
        this.pendingTransfer = undefined;
        reject(error);
      }
    });
  }

  protected handleSignalingMessage(_message: InboundMessage) {}

  public async toggleReceive(toReceive: boolean) {
    const requestMessage = new RequestMessage(
      `INVITE ${extractAddress(this.remotePeer)} SIP/2.0`,
      {
        "Call-Id": this.callId,
        From: this.localPeer,
        To: this.remotePeer,
        Via: `SIP/2.0/TLS ${this.softphone.signaling.localAddress}:${this.softphone.signaling.localPort};rport;branch=${branch()};alias`,
        "Content-Type": "application/sdp",
        Contact: ` <sip:${this.softphone.sipInfo.username}@${this.softphone.signaling.localAddress}:${this.softphone.signaling.localPort};transport=TLS;ob>`,
      },
      toReceive ? this.sdp : this.sdp.replace(/a=sendrecv/, "a=sendonly"),
    );
    const replyMessage = await this.softphone.signaling.request(requestMessage);
    const ackMessage = new RequestMessage(
      `ACK ${extractAddress(this.remotePeer)} SIP/2.0`,
      {
        "Call-Id": this.callId,
        From: this.localPeer,
        To: this.remotePeer,
        Via: replyMessage.getHeader("Via"),
        CSeq: replyMessage.cseqFor("ACK"),
      },
    );
    this.softphone.signaling.send(ackMessage);
  }

  public async hold() {
    return this.toggleReceive(false);
  }

  public async unhold() {
    return this.toggleReceive(true);
  }

  private signalingHandler = (message: InboundMessage) => {
    if (message.callId !== this.callId) {
      return;
    }
    if (message.getHeader("CSeq")?.endsWith(" BYE")) {
      this.dispose();
      return;
    }
    if (this.pendingTransfer && message.method === "NOTIFY") {
      this.softphone.signaling.send(new ResponseMessage(message, "200 OK"));
      if (message.body.trim() === "SIP/2.0 200 OK") {
        const { resolve } = this.pendingTransfer;
        this.pendingTransfer = undefined;
        resolve();
      }
      return;
    }
    this.handleSignalingMessage(message);
  };
}

export default CallSession;
