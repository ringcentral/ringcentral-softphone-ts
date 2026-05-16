import type InboundMessage from "../inbound/index.js";
import responseCodes from "../response-codes.js";
import OutboundMessage from "./index.js";

class ResponseMessage extends OutboundMessage {
  public constructor(
    inboundMessage: InboundMessage,
    responseCode: number,
    headers = {},
    body = "",
  ) {
    super(undefined, { ...headers }, body);
    this.subject = `SIP/2.0 ${responseCode} ${responseCodes[responseCode]}`;
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

export default ResponseMessage;
