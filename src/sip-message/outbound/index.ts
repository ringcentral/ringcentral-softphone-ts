import SipMessage from "../sip-message";

class OutboundMessage extends SipMessage {
  public constructor(subject = "", headers = {}, body = "") {
    super(subject, headers, body);
    this.headers["Content-Length"] = this.body.length.toString();
    this.headers["User-Agent"] = "ringcentral-softphone-ts";
  }
}

export default OutboundMessage;
