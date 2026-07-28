import { describe, expect, test } from "vitest";

import InboundMessage from "../src/sip-message/inbound/index.js";
import ResponseMessage from "../src/sip-message/outbound/response.js";

describe("ResponseMessage", () => {
  test.each([
    "200 OK",
    "603 Decline",
  ])("creates the %s status line", (status) => {
    const inboundMessage = InboundMessage.fromString(
      [
        "NOTIFY sip:1001@example.com SIP/2.0",
        "Via: SIP/2.0/TLS example.com",
        "From: <sip:1002@example.com>",
        "To: <sip:1001@example.com>;tag=local",
        "Call-ID: call-123",
        "CSeq: 1 NOTIFY",
        "Content-Length: 0",
        "",
        "",
      ].join("\r\n"),
    );

    const response = new ResponseMessage(inboundMessage, status);

    expect(response.subject).toBe(`SIP/2.0 ${status}`);
  });
});
