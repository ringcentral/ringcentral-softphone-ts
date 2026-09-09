import { once } from "node:events";
import { describe, expect, test, vi } from "vitest";

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
  test("callee preserves a call across signaling recovery", async () => {
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

      let outboundWasDisposed = false;
      let inboundWasDisposed = false;
      const outboundDisposed = once(outboundSession, "disposed").then(() => {
        outboundWasDisposed = true;
      });
      const inboundDisposed = once(inboundSession, "disposed").then(() => {
        inboundWasDisposed = true;
      });

      const previousSignaling = callee.signaling;
      const reset = Object.assign(new Error("read ECONNRESET"), {
        code: "ECONNRESET",
      });
      (
        previousSignaling as unknown as {
          socket: { destroy(error: Error): void };
        }
      ).socket.destroy(reset);
      await vi.waitFor(
        () => expect(callee.signaling).not.toBe(previousSignaling),
        { timeout: 30_000 },
      );
      expect(outboundWasDisposed).toBe(false);
      expect(inboundWasDisposed).toBe(false);

      await inboundSession.hangup();
      await inboundDisposed;
      if (!outboundWasDisposed) {
        await outboundSession.hangup();
      }
      await outboundDisposed;
    } finally {
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
