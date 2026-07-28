import { describe, expect, test } from "vitest";

import {
  InboundMessage,
  OutboundMessage,
  RequestMessage,
  ResponseMessage,
  SipMessage,
} from "../src/sip-message.js";

describe("SIP messages", () => {
  test("parses an inbound message and looks up headers case-insensitively", () => {
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
    expect(message.getHeader("call-id")).toBe("call-123");
    expect(message.getHeader("TO")).toMatch(/;tag=.+/);
  });

  test("normalizes bodies, serializes messages, and adds outbound headers", () => {
    const message = new SipMessage(
      "MESSAGE sip:1001 SIP/2.0",
      {
        Test: "value",
      },
      " first\nsecond ",
    );
    const outbound = new OutboundMessage("MESSAGE sip:1001 SIP/2.0", {}, "hi");

    expect(message.body).toBe("first\r\nsecond\r\n");
    expect(message.toString()).toBe(
      "MESSAGE sip:1001 SIP/2.0\r\nTest: value\r\n\r\nfirst\r\nsecond\r\n",
    );
    expect(outbound.headers["Content-Length"]).toBe(
      outbound.body.length.toString(),
    );
    expect(outbound.headers["User-Agent"]).toBe("ringcentral-softphone-ts");
  });

  test("generates a CSeq and updates it and the Via branch when forking", () => {
    const message = new RequestMessage(
      "INVITE sip:1001@example.com SIP/2.0",
      { Via: "SIP/2.0/TLS example.com;branch=old" },
      "body",
    );
    const fork = message.fork();
    const initialCseq = Number(message.headers.CSeq.split(" ")[0]);
    const forkedCseq = Number(fork.headers.CSeq.split(" ")[0]);

    expect(message.headers.CSeq).toMatch(/ INVITE$/);
    expect(forkedCseq).toBe(initialCseq + 1);
    expect(fork.subject).toBe(message.subject);
    expect(fork.body).toBe(message.body);
    expect(fork.headers).not.toBe(message.headers);
    expect(message.headers.Via).toMatch(/;branch=old$/);
    expect(fork.headers.Via).not.toBe(message.headers.Via);
    expect(fork.headers.Via).toMatch(/;branch=.+$/);
  });

  test.each([
    "200 OK",
    "603 Decline",
  ])("creates the %s response status line", (status) => {
    const response = new ResponseMessage(new InboundMessage(), status);

    expect(response.subject).toBe(`SIP/2.0 ${status}`);
  });

  test("copies required response headers case-insensitively with their original casing", () => {
    const inbound = new InboundMessage("NOTIFY sip:1001 SIP/2.0", {
      via: "SIP/2.0/TLS example.com",
      FROM: "<sip:1002@example.com>",
      To: "<sip:1001@example.com>;tag=local",
      "Call-Id": "call-123",
      cSeQ: "1 NOTIFY",
      Extra: "not copied",
    });
    const response = new ResponseMessage(
      inbound,
      "200 OK",
      { Custom: "value" },
      "body",
    );

    expect(response.headers).toMatchObject({
      via: inbound.headers.via,
      FROM: inbound.headers.FROM,
      To: inbound.headers.To,
      "Call-Id": inbound.headers["Call-Id"],
      cSeQ: inbound.headers.cSeQ,
      Custom: "value",
    });
    expect(response.headers.Extra).toBeUndefined();
  });
});
