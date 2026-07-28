import { branch, uuid } from "./utils.js";

export class SipMessage {
  public subject: string;
  public headers: {
    [key: string]: string;
  };
  public body: string;

  public constructor(subject = "", headers = {}, body = "") {
    this.subject = subject;
    this.headers = headers;
    this.body = body
      .trim()
      .split(/[\r\n]+/)
      .join("\r\n");
    if (this.body.length > 0) {
      this.body += "\r\n";
    }
  }

  public toString() {
    const r = [
      this.subject,
      ...Object.keys(this.headers).map((key) => `${key}: ${this.headers[key]}`),
      "",
      this.body,
    ].join("\r\n");
    return r;
  }

  public getHeader(key: string): string | undefined {
    const foundKey = Object.keys(this.headers).find(
      (k) => k.toLowerCase() === key.toLowerCase(),
    );
    if (foundKey) {
      return this.headers[foundKey];
    }
  }
}

export class InboundMessage extends SipMessage {
  public static fromString(str: string) {
    const sipMessage = new InboundMessage();
    const [init, ...body] = str.split("\r\n\r\n");
    sipMessage.body = body.join("\r\n\r\n");
    const [subject, ...headers] = init.split("\r\n");
    sipMessage.subject = subject;
    sipMessage.headers = Object.fromEntries(
      headers.map((line) => line.split(": ")),
    );
    if (sipMessage.headers.To && !sipMessage.headers.To.includes(";tag=")) {
      sipMessage.headers.To += `;tag=${uuid()}`; // generate local tag
    }
    return sipMessage;
  }
}

export class OutboundMessage extends SipMessage {
  public constructor(subject = "", headers = {}, body = "") {
    super(subject, headers, body);
    this.headers["Content-Length"] = this.body.length.toString();
    this.headers["User-Agent"] = "ringcentral-softphone-ts";
  }
}

let cseq = Math.floor(Math.random() * 10000);

export class RequestMessage extends OutboundMessage {
  public constructor(subject = "", headers = {}, body = "") {
    super(subject, headers, body);
    if (this.headers.CSeq === undefined) {
      this.newCseq();
    }
  }

  public newCseq() {
    this.headers.CSeq = `${++cseq} ${this.subject.split(" ")[0]}`;
  }

  public fork() {
    const newMessage = new RequestMessage(
      this.subject,
      { ...this.headers },
      this.body,
    );
    newMessage.newCseq();
    if (newMessage.headers.Via) {
      newMessage.headers.Via = newMessage.headers.Via.replace(
        /;branch=.+?$/,
        `;branch=${branch()}`,
      );
    }
    return newMessage;
  }
}

export class ResponseMessage extends OutboundMessage {
  public constructor(
    inboundMessage: InboundMessage,
    status: string,
    headers = {},
    body = "",
  ) {
    super(undefined, { ...headers }, body);
    this.subject = `SIP/2.0 ${status}`;
    const requiredKeys = new Set(["via", "from", "to", "call-id", "cseq"]);
    const allKeys = Object.keys(inboundMessage.headers).reduce(
      (acc, key) => {
        acc[key.toLowerCase()] = key;
        return acc;
      },
      {} as Record<string, string>,
    );
    for (const key of requiredKeys) {
      if (allKeys[key]) {
        const originalKey = allKeys[key];
        this.headers[originalKey] = inboundMessage.headers[originalKey];
      }
    }
  }
}
