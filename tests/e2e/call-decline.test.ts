import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, test } from "vitest";

import Softphone, {
  type InboundInvite,
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
const OBSERVATION_WINDOW_MS = 2_000;

const forceDisposeOutboundSession = (session: OutboundCallSession) => {
  try {
    void session.hangup();
  } catch {}
  (session as unknown as { media: { dispose(): boolean } }).media.dispose();
};

describe("E2E call decline", () => {
  test("callee decline ends only the presented callee leg while the caller leg stays answered", async () => {
    const callerOptions = sipConfigFromPrefix("SIP_A");
    const calleeOptions = sipConfigFromPrefix("SIP_B");
    const caller = new Softphone(callerOptions);
    const callee = new Softphone(calleeOptions);

    let outboundSession: OutboundCallSession | undefined;
    let outboundWasDisposed = false;
    let declineInvoked = false;
    let declineCompletedAt: number | undefined;
    let cleanupHangupBegan = false;
    let answeredAt: number | undefined;
    let answeredCount = 0;
    let serverDrivenDisposedCount = 0;
    let cleanupDisposedCount = 0;
    const scenarioStart = Date.now();
    const observedEvents: string[] = [];
    const non2xxStatusCodes: number[] = [];

    const describeFailure = (phase: string) =>
      [
        `call decline scenario failed in phase "${phase}"`,
        `elapsed ${Date.now() - scenarioStart} ms of the ${SCENARIO_DEADLINE_MS} ms scenario deadline`,
        `decline invoked: ${declineInvoked}`,
        `decline completed: ${declineCompletedAt !== undefined}`,
        `cleanup hangup began: ${cleanupHangupBegan}`,
        `observed public event sequence: ${
          observedEvents.length === 0 ? "none" : observedEvents.join(" -> ")
        }`,
        `answered events: ${answeredCount}`,
        `non2xxResponse status codes: ${
          non2xxStatusCodes.length === 0 ? "none" : non2xxStatusCodes.join(", ")
        }`,
        `server-driven disposed events: ${serverDrivenDisposedCount}`,
        `cleanup disposed events: ${cleanupDisposedCount}`,
      ].join("; ");

    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        reject(new Error(describeFailure("scenario deadline exceeded")));
      }, SCENARIO_DEADLINE_MS);
    });
    void deadline.catch(() => {});

    const boundedPhase = async (
      phase: string,
      operation: () => Promise<void>,
    ) => {
      const operationPromise = operation();
      void operationPromise.catch(() => {});
      try {
        await Promise.race([operationPromise, deadline]);
      } catch (error) {
        throw new Error(describeFailure(phase), { cause: error });
      }
    };

    try {
      await boundedPhase("registering both softphones", async () => {
        await Promise.all([caller.register(), callee.register()]);
      });

      // B's invite listener is armed before A places the call.
      const invitePromise = (
        once(callee, "invite") as Promise<[InboundInvite]>
      ).then(([invite]) => invite);

      let outbound: OutboundCallSession | undefined;
      await boundedPhase("awaiting outbound call session", async () => {
        outbound = await caller.call(calleeOptions.username);
        outboundSession = outbound;

        // A's observations are armed before B's invite is expected.
        outbound.on("non2xxResponse", (response) => {
          observedEvents.push(`non2xxResponse ${response.statusCode}`);
          non2xxStatusCodes.push(response.statusCode);
        });
        outbound.on("answered", () => {
          observedEvents.push("answered");
          answeredCount += 1;
          answeredAt ??= Date.now();
        });
        outbound.on("disposed", () => {
          observedEvents.push("disposed");
          if (cleanupHangupBegan) {
            cleanupDisposedCount += 1;
          } else {
            serverDrivenDisposedCount += 1;
          }
          outboundWasDisposed = true;
        });
      });

      let invite: InboundInvite | undefined;
      await boundedPhase("awaiting inbound invite", async () => {
        invite = await invitePromise;
      });

      await boundedPhase("declining the inbound invite", async () => {
        // B declines the separately presented invite exactly once without
        // answering it or creating an inbound call session.
        declineInvoked = true;
        await callee.decline(invite!);
        declineCompletedAt = Date.now();
      });

      await boundedPhase("post-decline observation window", async () => {
        // Observation window: A stays answered, with no decline propagation.
        await sleep(OBSERVATION_WINDOW_MS);

        expect(declineInvoked).toBe(true);
        expect(answeredCount).toBeGreaterThanOrEqual(1);
        expect(answeredAt).toBeDefined();
        expect(answeredAt).toBeLessThan(declineCompletedAt!);
        expect(non2xxStatusCodes).toEqual([]);
        expect(serverDrivenDisposedCount).toBe(0);
      });

      await boundedPhase("cleanup hangup and disposal", async () => {
        // Explicit cleanup: A's hangup causes the only expected disposal.
        const cleanupDisposedPromise = once(outbound!, "disposed");
        cleanupHangupBegan = true;
        await outbound!.hangup();
        await cleanupDisposedPromise;
        expect(cleanupDisposedCount).toBe(1);
        expect(serverDrivenDisposedCount).toBe(0);
      });
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
