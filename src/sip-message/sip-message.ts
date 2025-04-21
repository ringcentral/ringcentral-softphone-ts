class SipMessage {
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
    const foundKey = Object.keys(this.headers).find((k) =>
      k.toLowerCase() === key.toLowerCase()
    );
    if (foundKey) {
      return this.headers[foundKey];
    }
  }
}

export default SipMessage;
