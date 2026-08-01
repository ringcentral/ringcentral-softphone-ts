import { branch, uuid } from "./utils.js";

const responseHeaders = new Set(["via", "from", "to", "call-id", "cseq"]);

export class SipMessage {
  public subject: string;
  public headers: Record<string, string>;
  public body: string;

  public constructor(subject = "", headers = {}, body = "") {
    this.subject = subject;
    this.headers = headers;
    this.body = body.trim().replace(/[\r\n]+/g, "\r\n");
    if (this.body.length > 0) {
      this.body += "\r\n";
    }
  }

  public toString() {
    return [
      this.subject,
      ...Object.keys(this.headers).map((key) => `${key}: ${this.headers[key]}`),
      "",
      this.body,
    ].join("\r\n");
  }

  public getHeader(key: string): string | undefined {
    return Object.entries(this.headers).find(
      ([header]) => header.toLowerCase() === key.toLowerCase(),
    )?.[1];
  }

  public get method(): string | undefined {
    return this.subject.match(/^(\S+) \S+ SIP\/2\.0$/)?.[1];
  }

  public get statusCode(): number | undefined {
    const statusCode = this.subject.match(/^SIP\/2\.0 (\d{3}) /)?.[1];
    return statusCode === undefined ? undefined : Number(statusCode);
  }

  public get callId(): string | undefined {
    return this.getHeader("Call-ID")?.trim() || undefined;
  }

  public get cseqNumber(): string | undefined {
    return this.getHeader("CSeq")?.match(/^\s*(\d+)\b/)?.[1];
  }

  public cseqFor(method: string): string {
    const number = this.cseqNumber;
    if (number === undefined) {
      throw new Error("Cannot create SIP CSeq without a valid CSeq header");
    }
    return `${number} ${method}`;
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
    super(`SIP/2.0 ${status}`, { ...headers }, body);
    for (const [key, value] of Object.entries(inboundMessage.headers)) {
      if (responseHeaders.has(key.toLowerCase())) {
        this.headers[key] = value;
      }
    }
  }
}
