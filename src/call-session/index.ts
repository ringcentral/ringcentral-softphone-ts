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
  const callId = message.getHeader("Call-ID")?.trim();
  if (!callId) {
    throw new Error("Cannot create call session without a Call-ID header");
  }
  return callId;
};

abstract class CallSession extends EventEmitter<OutboundCallSessionEventMap> {
  public softphone: Softphone;
  public sipMessage: InboundMessage;
  public localPeer!: string;
  public remotePeer!: string;
  public media: MediaTransport;
  public sdp!: string;
  public readonly callId: string;

  private byeHandler?: (message: InboundMessage) => void;

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
    if (!this.media.dispose()) {
      return;
    }
    this.emit("disposed");
    this.removeAllListeners();
    if (this.byeHandler) {
      this.softphone.off("message", this.byeHandler);
      this.byeHandler = undefined;
    }
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
