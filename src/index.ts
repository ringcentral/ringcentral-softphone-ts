import EventEmitter from "node:events";
import tls, { TLSSocket } from "node:tls";

import waitFor from "wait-for-async";

import InboundCallSession from "./call-session/inbound.js";
import OutboundCallSession from "./call-session/outbound.js";
import {
  InboundMessage,
  OutboundMessage,
  RequestMessage,
  ResponseMessage,
} from "./sip-message/index.js";
import {
  branch,
  generateAuthorization,
  localKey,
  randomInt,
  uuid,
} from "./utils.js";
import { SoftPhoneOptions } from "./types.js";
import Codec from "./codec.js";

class Softphone extends EventEmitter {
  public sipInfo: SoftPhoneOptions;
  public client: TLSSocket;
  public codec: Codec;

  public fakeDomain = uuid() + ".invalid";
  public fakeEmail = uuid() + "@" + this.fakeDomain;

  private intervalHandle: NodeJS.Timeout;
  private connected = false;

  public constructor(sipInfo: SoftPhoneOptions) {
    super();
    if (sipInfo.codec === undefined) {
      sipInfo.codec = "OPUS/16000";
    }
    this.codec = new Codec(sipInfo.codec);
    this.sipInfo = sipInfo;
    if (this.sipInfo.domain === undefined) {
      this.sipInfo.domain = "sip.ringcentral.com";
    }
    if (this.sipInfo.outboundProxy === undefined) {
      this.sipInfo.outboundProxy = "sip10.ringcentral.com:5096";
    }
    const tokens = this.sipInfo.outboundProxy!.split(":");
    this.client = tls.connect(
      { host: tokens[0], port: parseInt(tokens[1], 10) },
      () => {
        this.connected = true;
      },
    );

    let cache = "";
    this.client.on("data", (data) => {
      cache += data.toString("utf-8");
      if (!cache.endsWith("\r\n")) {
        return; // haven't received a complete message yet
      }
      // received two empty body messages
      const tempMessages = cache
        .split("\r\nContent-Length: 0\r\n\r\n")
        .filter((message) => message.trim() !== "");
      cache = "";
      for (let i = 0; i < tempMessages.length; i++) {
        if (!tempMessages[i].includes("Content-Length: ")) {
          tempMessages[i] = tempMessages[i] + "\r\nContent-Length: 0";
        }
      }
      for (const message of tempMessages) {
        this.emit("message", InboundMessage.fromString(message));
      }
    });
  }

  private instanceId = uuid();
  private registerCallId = uuid();

  public async register() {
    if (!this.connected) {
      await waitFor({ interval: 100, condition: () => this.connected });
    }
    const sipRegister = async () => {
      const fromTag = uuid();
      const requestMessage = new RequestMessage(
        `REGISTER sip:${this.sipInfo.domain} SIP/2.0`,
        {
          Via:
            `SIP/2.0/TLS ${this.client.localAddress}:${this.client.localPort};rport;branch=${branch()};alias`,
          "Max-Forwards": "70",
          From:
            `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${fromTag}`,
          To: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>`,
          "Call-ID": this.registerCallId,
          Contact:
            `<sip:${this.sipInfo.username}@${this.client.localAddress}:${this.client.localPort};transport=TLS;ob>;reg-id=1;+sip.instance="<urn:uuid:${this.instanceId}>"`,
          Expires: 3600,
          Allow:
            "PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS",
        },
      );
      const inboundMessage = await this.send(requestMessage, true);
      if (inboundMessage.subject.startsWith("SIP/2.0 200 ")) {
        // sometimes the server will return 200 OK directly
        return;
      }
      const wwwAuth = inboundMessage.getHeader("Www-Authenticate")!;
      const nonce = wwwAuth.match(/, nonce="(.+?)"/)![1];
      const newMessage = requestMessage.fork();
      newMessage.headers.Authorization = generateAuthorization(
        this.sipInfo,
        nonce,
        "REGISTER",
      );
      await this.send(newMessage, true);
    };
    await sipRegister();
    this.intervalHandle = setInterval(
      () => {
        sipRegister();
      },
      30 * 1000, // refresh registration every 30 seconds
    );
    this.on("message", (inboundMessage) => {
      if (!inboundMessage.subject.startsWith("INVITE sip:")) {
        return;
      }
      const outboundMessage = new OutboundMessage("SIP/2.0 100 Trying", {
        Via: inboundMessage.headers.Via,
        "Call-ID": inboundMessage.getHeader("Call-ID"),
        From: inboundMessage.headers.From,
        To: inboundMessage.headers.To,
        CSeq: inboundMessage.headers.CSeq,
        "Content-Length": "0",
      });
      this.send(outboundMessage);
      this.emit("invite", inboundMessage);
    });
  }

  public enableDebugMode() {
    this.on(
      "message",
      (message) =>
        console.log(`Receiving...(${new Date()})\n` + message.toString()),
    );
    const tlsWrite = this.client.write.bind(this.client);
    this.client.write = (message) => {
      console.log(`Sending...(${new Date()})\n` + message);
      return tlsWrite(message);
    };
  }

  public revoke() {
    clearInterval(this.intervalHandle);
    this.removeAllListeners();
    this.client.removeAllListeners();
    this.client.destroy();
  }

  public send(
    message: OutboundMessage,
    waitForReply?: true,
  ): Promise<InboundMessage>;
  public send(
    message: OutboundMessage,
    waitForReply?: false,
  ): Promise<undefined>;
  public send(message: OutboundMessage, waitForReply = false) {
    this.client.write(message.toString());
    if (!waitForReply) {
      return new Promise<undefined>((resolve) => {
        resolve(undefined);
      });
    }
    return new Promise<InboundMessage>((resolve) => {
      const messageListerner = (inboundMessage: InboundMessage) => {
        if (inboundMessage.headers.CSeq !== message.headers.CSeq) {
          return;
        }
        if (inboundMessage.subject.startsWith("SIP/2.0 100 ")) {
          return; // ignore
        }
        this.off("message", messageListerner);
        resolve(inboundMessage);
      };
      this.on("message", messageListerner);
    });
  }

  public async answer(inviteMessage: InboundMessage) {
    const inboundCallSession = new InboundCallSession(this, inviteMessage);
    await inboundCallSession.answer();
    return inboundCallSession;
  }

  // decline an inbound call
  public async decline(inviteMessage: InboundMessage) {
    const newMessage = new ResponseMessage(inviteMessage, 603);
    await this.send(newMessage);
  }

  public async call(callee: string) {
    const offerSDP = `
v=0
o=- ${Date.now()} 0 IN IP4 ${this.client.localAddress}
s=rc-softphone-ts
c=IN IP4 ${this.client.localAddress}
t=0 0
m=audio ${randomInt()} RTP/SAVP ${this.codec.id} 101
a=rtpmap:${this.codec.id} ${this.codec.name}
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
a=sendrecv
a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${localKey}
  `.trim();
    const inviteMessage = new RequestMessage(
      `INVITE sip:${callee}@${this.sipInfo.domain} SIP/2.0`,
      {
        Via:
          `SIP/2.0/TLS ${this.client.localAddress}:${this.client.localPort};rport;branch=${branch()};alias`,
        "Max-Forwards": 70,
        From:
          `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${uuid()}`,
        To: `<sip:${callee}@sip.ringcentral.com>`,
        Contact:
          ` <sip:${this.sipInfo.username}@${this.client.localAddress}:${this.client.localPort};transport=TLS;ob>`,
        "Call-ID": uuid(),
        Route: `<sip:${this.sipInfo.outboundProxy};transport=tls;lr>`,
        Allow:
          `PRACK, INVITE, ACK, BYE, CANCEL, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, OPTIONS`,
        Supported: `replaces, 100rel, timer, norefersub`,
        "Session-Expires": 1800,
        "Min-SE": 90,
        "Content-Type": "application/sdp",
      },
      offerSDP,
    );
    const inboundMessage = await this.send(inviteMessage, true);
    const proxyAuthenticate = inboundMessage.getHeader("Proxy-Authenticate")!;
    const nonce = proxyAuthenticate.match(/, nonce="(.+?)"/)![1];
    const newMessage = inviteMessage.fork();
    newMessage.headers["Proxy-Authorization"] = generateAuthorization(
      this.sipInfo,
      nonce,
      "INVITE",
    );
    const progressMessage = await this.send(newMessage, true);
    return new OutboundCallSession(this, progressMessage);
  }
}

export default Softphone;
