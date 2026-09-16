import { once } from "node:events";
import { describe, expect, test } from "vitest";

import Softphone, {
  type InboundInvite,
  type Non2xxResponse,
  type OutboundCallSession,
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

const SCENARIO_DEADLINE_MS = 30_000;

const forceDisposeOutboundSession = (session: OutboundCallSession) => {
  try {
    void session.hangup();
  } catch {}
  (session as unknown as { media: { dispose(): boolean } }).media.dispose();
};

describe("E2E call decline", () => {
  test("callee declines an inbound call and the caller observes one 603 Decline before disposal", async () => {
    const callerOptions = sipConfigFromPrefix("SIP_A");
    const calleeOptions = sipConfigFromPrefix("SIP_B");
    const caller = new Softphone(callerOptions);
    const callee = new Softphone(calleeOptions);

    let outboundSession: OutboundCallSession | undefined;
    let outboundWasDisposed = false;
    let declineInvoked = false;
    let answeredCount = 0;
    let disposedCount = 0;
    let scenarioStart = Date.now();
    const observedEvents: string[] = [];
    const non2xxResponses: Non2xxResponse[] = [];

    const describeFailure = (phase: string) =>
      [
        `call decline scenario failed in phase "${phase}"`,
        `elapsed ${Date.now() - scenarioStart} ms of the ${SCENARIO_DEADLINE_MS} ms scenario deadline`,
        `decline invoked: ${declineInvoked}`,
        `observed public event sequence: ${
          observedEvents.length === 0 ? "none" : observedEvents.join(" -> ")
        }`,
        `terminal response payload: ${
          non2xxResponses.length === 0
            ? "none"
            : JSON.stringify(non2xxResponses)
        }`,
        `answered events: ${answeredCount}, disposed events: ${disposedCount}`,
      ].join("; ");

    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        reject(new Error(describeFailure("scenario deadline exceeded")));
      }, SCENARIO_DEADLINE_MS);
    });
    void deadline.catch(() => {});

    try {
      await Promise.all([caller.register(), callee.register()]);

      // B's invite listener is armed before A places the call.
      const invitePromise = (
        once(callee, "invite") as Promise<[InboundInvite]>
      ).then(([invite]) => invite);

      scenarioStart = Date.now();
      const scenario = (async () => {
        const outbound = await caller.call(calleeOptions.username);
        outboundSession = outbound;

        // A's observations are armed before B declines.
        outbound.on("non2xxResponse", (response) => {
          observedEvents.push(`non2xxResponse ${response.statusCode}`);
          non2xxResponses.push(response);
        });
        outbound.on("answered", () => {
          observedEvents.push("answered");
          answeredCount += 1;
        });
        outbound.on("disposed", () => {
          observedEvents.push("disposed");
          disposedCount += 1;
          outboundWasDisposed = true;
        });

        const responsePromise = once(outbound, "non2xxResponse") as Promise<
          [Non2xxResponse]
        >;
        const disposedPromise = once(outbound, "disposed");

        // B declines the invite exactly once without answering it.
        const invite = await invitePromise;
        declineInvoked = true;
        await callee.decline(invite);

        const [response] = await responsePromise;
        await disposedPromise;
        return response;
      })();

      const response = await Promise.race([scenario, deadline]);

      expect(declineInvoked).toBe(true);
      expect(response).toEqual({ statusCode: 603, reasonPhrase: "Decline" });
      expect(non2xxResponses).toEqual([response]);
      expect(answeredCount).toBe(0);
      expect(disposedCount).toBe(1);
      expect(observedEvents).toEqual(["non2xxResponse 603", "disposed"]);
    } finally {
      clearTimeout(deadlineTimer);
      if (outboundSession && !outboundWasDisposed) {
        forceDisposeOutboundSession(outboundSession);
      }
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
