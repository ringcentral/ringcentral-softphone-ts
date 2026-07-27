import { describe, expect, test } from "vitest";

import InboundMessage from "../src/sip-message/inbound/index.js";

describe("InboundMessage", () => {
  test("fromString returns an InboundMessage", () => {
    const message = InboundMessage.fromString(
      [
        "INVITE sip:16505550100@sip.ringcentral.com SIP/2.0",
        "To: <sip:16505550100@sip.ringcentral.com>",
        "Call-ID: call-123",
        "Content-Length: 0",
        "",
        "",
      ].join("\r\n"),
    );

    expect(message).toBeInstanceOf(InboundMessage);
    expect(message.getHeader("Call-ID")).toBe("call-123");
    expect(message.getHeader("To")).toMatch(/;tag=.+/);
  });
});
