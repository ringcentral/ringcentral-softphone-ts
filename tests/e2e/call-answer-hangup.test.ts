import "dotenv-override-true/config";
import { once } from "node:events";
import process from "node:process";
import { describe, expect, test } from "vitest";

import Softphone, {
  type InboundInvite,
  type SoftphoneOptions,
} from "../../src/index.js";

const requiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env var: ${key}`);
  }
  return value;
};

const sipConfigFromPrefix = (prefix: "SIP_A" | "SIP_B"): SoftphoneOptions => ({
  outboundProxy: requiredEnv(`${prefix}_OUTBOUND_PROXY`),
  username: requiredEnv(`${prefix}_USERNAME`),
  password: requiredEnv(`${prefix}_PASSWORD`),
  authorizationId: requiredEnv(`${prefix}_AUTHORIZATION_ID`),
  domain: requiredEnv(`${prefix}_DOMAIN`),
});

describe("E2E call flow", () => {
  test("one softphone calls the other, callee answers, caller hangs up", async () => {
    const callerOptions = sipConfigFromPrefix("SIP_A");
    const calleeOptions = sipConfigFromPrefix("SIP_B");
    const caller = new Softphone(callerOptions);
    const callee = new Softphone(calleeOptions);
    const inboundCallPromise = (
      once(callee, "invite") as Promise<[InboundInvite]>
    ).then(async ([invite]) => ({
      invite,
      session: await callee.answer(invite),
    }));

    try {
      await Promise.all([caller.register(), callee.register()]);

      const outboundSession = await caller.call(calleeOptions.username);
      const answeredPromise = once(outboundSession, "answered");
      const { invite, session: inboundSession } = await inboundCallPromise;

      await answeredPromise;
      expect(invite).toBeDefined();
      expect(outboundSession.callId).not.toBe("");
      expect(inboundSession.callId).not.toBe("");

      const outboundDisposed = once(outboundSession, "disposed");
      const inboundDisposed = once(inboundSession, "disposed");
      await outboundSession.hangup();
      await Promise.all([outboundDisposed, inboundDisposed]);
    } finally {
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
