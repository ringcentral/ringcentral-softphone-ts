import OutboundMessage from "./index.js";
import type InboundMessage from "../inbound/index.js";
import responseCodes from "../response-codes.js";

class ResponseMessage extends OutboundMessage {
  public constructor(
    inboundMessage: InboundMessage,
    responseCode: number,
    headers = {},
    body = "",
  ) {
    super(undefined, { ...headers }, body);
    this.subject = `SIP/2.0 ${responseCode} ${responseCodes[responseCode]}`;
    const keys = ["Via", "From", "To", "Call-ID", "CSeq"];
    for (const key of keys) {
      if (inboundMessage.headers[key]) {
        this.headers[key] = inboundMessage.headers[key];
      }
    }
  }
}

export default ResponseMessage;
