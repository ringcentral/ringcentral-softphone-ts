import { describe, expect, test } from "vitest";

import { requireCallId } from "../src/call-session/index.js";
import { parseTelephonyId } from "../src/call-session/outbound.js";
import InboundMessage from "../src/sip-message/inbound/index.js";

const messageWithCallId = (callId?: string) => {
  const header = callId === undefined ? "" : `Call-ID: ${callId}\r\n`;
  return InboundMessage.fromString(
    `SIP/2.0 180 Ringing\r\n${header}CSeq: 1 INVITE\r\n\r\n`,
  );
};

describe("call session identifiers", () => {
  test("requires a nonblank Call-ID when creating a session", () => {
    expect(requireCallId(messageWithCallId("call-123"))).toBe("call-123");
    expect(() => requireCallId(messageWithCallId())).toThrow(
      "Cannot create call session without a Call-ID header",
    );
    expect(() => requireCallId(messageWithCallId("   "))).toThrow(
      "Cannot create call session without a Call-ID header",
    );
  });

  test("parses telephony IDs without throwing on absent or malformed values", () => {
    const header = "SESSION-ID=session-456; PARTY-ID=party-123";

    expect(parseTelephonyId(header, "party-id")).toBe("party-123");
    expect(parseTelephonyId(header, "session-id")).toBe("session-456");
    expect(parseTelephonyId(undefined, "session-id")).toBeUndefined();
    expect(parseTelephonyId("unrelated=value", "party-id")).toBeUndefined();
    expect(
      parseTelephonyId("session-id= ;party-id=", "session-id"),
    ).toBeUndefined();
  });
});
