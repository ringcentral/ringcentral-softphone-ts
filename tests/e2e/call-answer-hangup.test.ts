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

const includes = (
  messages: InboundMessage[],
  predicate: (message: InboundMessage) => boolean,
) => messages.some(predicate);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("E2E call flow", () => {
  test("one softphone calls the other, callee answers, caller hangs up", async () => {
    const caller = new Softphone(sipConfigFromPrefix("SIP_A"));
    const callee = new Softphone(sipConfigFromPrefix("SIP_B"));
    const callerInbound: InboundMessage[] = [];
    const calleeInbound: InboundMessage[] = [];

    caller.on("message", (message: InboundMessage) =>
      callerInbound.push(message),
    );
    callee.on("message", (message: InboundMessage) =>
      calleeInbound.push(message),
    );

    try {
      await Promise.all([caller.register(), callee.register()]);

      let calleeSessionDisposePromise: Promise<unknown> | undefined;
      callee.once("invite", async (inviteMessage: InboundMessage) => {
        const inboundSession = await callee.answer(inviteMessage);
        calleeSessionDisposePromise = once(inboundSession, "disposed");
      });

      const outboundSession = await caller.call(callee.sipInfo.username);
      await once(outboundSession, "answered");

      await outboundSession.hangup();
      if (calleeSessionDisposePromise) {
        await calleeSessionDisposePromise;
      }
      await delay(300);

      console.log(JSON.stringify(callerInbound, null, 2));
      console.log(JSON.stringify(calleeInbound, null, 2));

      expect(
        includes(calleeInbound, (message) =>
          message.subject.startsWith(`INVITE sip:${callee.sipInfo.username}@`),
        ),
      ).toBe(true);
      expect(
        includes(calleeInbound, (message) =>
          message.subject.startsWith("ACK sip:"),
        ),
      ).toBe(true);
      expect(
        includes(calleeInbound, (message) =>
          message.subject.startsWith("BYE sip:"),
        ),
      ).toBe(true);
      expect(
        includes(
          callerInbound,
          (message) =>
            message.subject.startsWith("SIP/2.0 200") &&
            (message.getHeader("CSeq")?.endsWith(" INVITE") ?? false),
        ),
      ).toBe(true);
      expect(
        includes(
          callerInbound,
          (message) =>
            message.subject.startsWith("SIP/2.0 200") &&
            (message.getHeader("CSeq")?.endsWith(" BYE") ?? false),
        ),
      ).toBe(true);
    } finally {
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
