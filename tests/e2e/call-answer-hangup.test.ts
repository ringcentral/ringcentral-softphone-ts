import "dotenv-override-true/config";
import { once } from "node:events";
import process from "node:process";
import { describe, expect, test } from "vitest";
import Softphone from "../../src/index.js";
import type InboundMessage from "../../src/sip-message/inbound/index.js";
import type { SoftPhoneOptions } from "../../src/types.js";

const requiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env var: ${key}`);
  }
  return value;
};

const sipConfigFromPrefix = (prefix: "SIP_A" | "SIP_B"): SoftPhoneOptions => ({
  outboundProxy: requiredEnv(`${prefix}_OUTBOUND_PROXY`),
  username: requiredEnv(`${prefix}_USERNAME`),
  password: requiredEnv(`${prefix}_PASSWORD`),
  authorizationId: requiredEnv(`${prefix}_AUTHORIZATION_ID`),
  domain: requiredEnv(`${prefix}_DOMAIN`),
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Side = "caller" | "callee";
type Direction = "inbound" | "outbound";
type SipTraceItem = {
  side: Side;
  direction: Direction;
  subject: string;
  content: string;
};

const getSubject = (rawMessage: string) => rawMessage.split("\r\n")[0] ?? "";

describe("E2E call flow", () => {
  test("one softphone calls the other, callee answers, caller hangs up", async () => {
    const caller = new Softphone(sipConfigFromPrefix("SIP_A"));
    const callee = new Softphone(sipConfigFromPrefix("SIP_B"));
    const sipTrace: SipTraceItem[] = [];

    try {
      await Promise.all([caller.register(), callee.register()]);

      const trackInbound = (side: Side, message: InboundMessage) => {
        sipTrace.push({
          side,
          direction: "inbound",
          subject: message.subject,
          content: message.toString(),
        });
      };
      const trackOutbound = (side: Side, rawMessage: string) => {
        sipTrace.push({
          side,
          direction: "outbound",
          subject: getSubject(rawMessage),
          content: rawMessage,
        });
      };
      caller.on("message", (message: InboundMessage) =>
        trackInbound("caller", message),
      );
      callee.on("message", (message: InboundMessage) =>
        trackInbound("callee", message),
      );
      caller.on("outboundMessage", (message: string) =>
        trackOutbound("caller", message),
      );
      callee.on("outboundMessage", (message: string) =>
        trackOutbound("callee", message),
      );

      let calleeSessionDisposePromise: Promise<unknown> | undefined;
      callee.once("invite", async (inviteMessage: InboundMessage) => {
        const inboundSession = await callee.answer(inviteMessage);
        calleeSessionDisposePromise = once(inboundSession, "disposed");
      });

      const outboundSession = await caller.call(callee.sipInfo.username);
      await once(outboundSession, "answered");
      const callId = outboundSession.callId;

      await outboundSession.hangup();
      if (calleeSessionDisposePromise) {
        await calleeSessionDisposePromise;
      }
      await delay(300);

      const callTrace = sipTrace.filter((item) =>
        item.content.includes(`Call-ID: ${callId}\r\n`),
      );
      expect(callTrace.length).toBeGreaterThan(0);

      const first = callTrace[0];
      const last = callTrace[callTrace.length - 1];

      // Placeholder assertions. Update these exact expectations later.
      expect(first.side).toBe("caller");
      expect(first.direction).toBe("outbound");
      expect(first.subject.startsWith("INVITE sip:")).toBe(true);

      expect(last.side).toBe("caller");
      expect(last.direction).toBe("inbound");
      expect(last.subject.startsWith("SIP/2.0 200")).toBe(true);
      expect(last.content.includes(" BYE")).toBe(true);
    } finally {
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
