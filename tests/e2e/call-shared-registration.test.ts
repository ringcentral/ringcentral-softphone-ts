import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, test } from "vitest";

import Softphone, {
  type CallSession,
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

// The whole scenario must stay below the first 30-second automatic
// registration refresh of either shared-credential B instance.
const SCENARIO_DEADLINE_MS = 25_000;
const REGISTRATION_PHASE_DEADLINE_MS = 10_000;
const CALL_PHASE_DEADLINE_MS = 10_000;
const OBSERVATION_WINDOW_MS = 2_000;
const OBSERVATION_PHASE_DEADLINE_MS = OBSERVATION_WINDOW_MS + 500;
const ASSERTION_PHASE_DEADLINE_MS = 1_000;

const forceDisposeSession = (session: CallSession | OutboundCallSession) => {
  try {
    void session.hangup();
  } catch {}
  (session as unknown as { media: { dispose(): boolean } }).media.dispose();
};

describe("E2E shared-registration routing", () => {
  test("the most recently registered shared-credential instance receives exactly one inbound call, answers it, and the older instance receives none", async () => {
    const callerOptions = sipConfigFromPrefix("SIP_A");
    // B-old and B-new are independent Softphone instances built from exactly
    // the same normalized B options, so this exercises shared-registration
    // routing rather than two separate accounts.
    const calleeOptions = sipConfigFromPrefix("SIP_B");
    const caller = new Softphone(callerOptions);
    const calleeOld = new Softphone(calleeOptions);
    const calleeNew = new Softphone(calleeOptions);

    let outboundSession: OutboundCallSession | undefined;
    let inboundSession: CallSession | undefined;
    let answeredInvite: InboundInvite | undefined;
    let outboundWasDisposed = false;
    let inboundWasDisposed = false;
    let callerRegistered = false;
    let oldRegistered = false;
    let newRegistered = false;

    // Public invite observers and counters are attached to both B instances
    // before registration begins, so an early or misrouted invite cannot be
    // missed. Invites are retained for best-effort cleanup on failure.
    const oldInvites: InboundInvite[] = [];
    const newInvites: InboundInvite[] = [];
    let notifyOldInvite: (() => void) | undefined;
    const oldInviteArrivedPromise = new Promise<void>((resolve) => {
      notifyOldInvite = resolve;
    });
    let notifyNewInvite: (() => void) | undefined;
    const newInviteArrivedPromise = new Promise<void>((resolve) => {
      notifyNewInvite = resolve;
    });
    calleeOld.on("invite", (invite) => {
      oldInvites.push(invite);
      notifyOldInvite?.();
    });
    calleeNew.on("invite", (invite) => {
      newInvites.push(invite);
      notifyNewInvite?.();
    });

    const scenarioStart = Date.now();

    // Diagnostics are sanitized: logical instance names, phases, invite
    // counts, answer/disposal state, and elapsed time only. Credentials, SIP
    // usernames, Call-IDs, and network addresses are never printed.
    const describeFailure = (phase: string) =>
      [
        `shared-registration routing scenario failed in phase "${phase}"`,
        `elapsed ${Date.now() - scenarioStart} ms of the ${SCENARIO_DEADLINE_MS} ms scenario deadline`,
        `registrations completed: A: ${callerRegistered}, B-old: ${oldRegistered}, B-new: ${newRegistered}`,
        `invite counts (logical instance names only): B-old: ${oldInvites.length}, B-new: ${newInvites.length}`,
        `selected instance: ${
          newInvites.length > 0
            ? "B-new"
            : oldInvites.length > 0
              ? "B-old (unexpected)"
              : "none"
        }`,
        `answer state: B-new answered the selected invite: ${answeredInvite !== undefined}`,
        `disposal state: A outbound leg disposed: ${outboundWasDisposed}, B-new inbound leg disposed: ${inboundWasDisposed}`,
      ].join("; ");

    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        reject(new Error(describeFailure("scenario deadline exceeded")));
      }, SCENARIO_DEADLINE_MS);
    });
    void deadline.catch(() => {});

    const boundedPhase = async <T>(
      phase: string,
      phaseDeadlineMs: number,
      operation: () => Promise<T>,
    ): Promise<T> => {
      let phaseTimer: NodeJS.Timeout | undefined;
      const phaseDeadline = new Promise<never>((_resolve, reject) => {
        phaseTimer = setTimeout(
          () =>
            reject(
              new Error(
                `phase "${phase}" exceeded its ${phaseDeadlineMs} ms deadline`,
              ),
            ),
          phaseDeadlineMs,
        );
      });
      const operationPromise = operation();
      void operationPromise.catch(() => {});
      try {
        return await Promise.race([operationPromise, phaseDeadline, deadline]);
      } catch (error) {
        throw new Error(describeFailure(phase), { cause: error });
      } finally {
        clearTimeout(phaseTimer);
      }
    };

    try {
      // Registration is strictly sequential in the order A, B-old, B-new, so
      // "most recently registered" deterministically means B-new.
      await boundedPhase(
        "registering A",
        REGISTRATION_PHASE_DEADLINE_MS,
        async () => {
          await caller.register();
          callerRegistered = true;
        },
      );
      await boundedPhase(
        "registering B-old",
        REGISTRATION_PHASE_DEADLINE_MS,
        async () => {
          await calleeOld.register();
          oldRegistered = true;
        },
      );
      await boundedPhase(
        "registering B-new",
        REGISTRATION_PHASE_DEADLINE_MS,
        async () => {
          await calleeNew.register();
          newRegistered = true;
        },
      );

      const outbound = await boundedPhase(
        "placing the outbound call from A",
        CALL_PHASE_DEADLINE_MS,
        () => caller.call(calleeOptions.username),
      );
      outboundSession = outbound;
      const answeredPromise = once(outbound, "answered");

      const oldInviteFailure = oldInviteArrivedPromise.then(() => {
        throw new Error(
          "the older shared-credential instance received the invite",
        );
      });
      void oldInviteFailure.catch(() => {});

      await boundedPhase(
        "awaiting B-new invite receipt",
        CALL_PHASE_DEADLINE_MS,
        async () => {
          await Promise.race([newInviteArrivedPromise, oldInviteFailure]);
          expect(
            newInvites.length,
            "B-new must receive exactly one invite at receipt",
          ).toBe(1);
        },
      );

      await boundedPhase(
        "observing B-old after B-new receipt",
        OBSERVATION_PHASE_DEADLINE_MS,
        async () => {
          expect(oldInvites.length, "B-old must not receive the invite").toBe(
            0,
          );
          await Promise.race([sleep(OBSERVATION_WINDOW_MS), oldInviteFailure]);
        },
      );

      await boundedPhase(
        "asserting invite routing counts",
        ASSERTION_PHASE_DEADLINE_MS,
        async () => {
          expect(
            newInvites.length,
            "B-new must receive exactly one invite",
          ).toBe(1);
          expect(
            oldInvites.length,
            "B-old must receive zero invites through B-new's receipt plus the observation window",
          ).toBe(0);
        },
      );

      const inbound = await boundedPhase(
        "answering on B-new",
        CALL_PHASE_DEADLINE_MS,
        async () => {
          const selectedInvite = newInvites[0];
          const session = await calleeNew.answer(selectedInvite);
          answeredInvite = selectedInvite;
          inboundSession = session;
          return session;
        },
      );

      await boundedPhase(
        "awaiting A answered",
        CALL_PHASE_DEADLINE_MS,
        () => answeredPromise,
      );

      await boundedPhase(
        "hanging up and awaiting disposal of both legs",
        CALL_PHASE_DEADLINE_MS,
        async () => {
          const outboundDisposed = once(outbound, "disposed").then(() => {
            outboundWasDisposed = true;
          });
          const inboundDisposed = once(inbound, "disposed").then(() => {
            inboundWasDisposed = true;
          });
          await outbound.hangup();
          await Promise.all([outboundDisposed, inboundDisposed]);
        },
      );
    } finally {
      clearTimeout(deadlineTimer);
      if (outboundSession && !outboundWasDisposed) {
        forceDisposeSession(outboundSession);
      }
      if (inboundSession && !inboundWasDisposed) {
        forceDisposeSession(inboundSession);
      }
      // Best-effort cleanup of any unexpected or duplicate unanswered invite
      // before revoking, without masking the original failure.
      for (const invite of newInvites) {
        if (invite !== answeredInvite) {
          try {
            await calleeNew.decline(invite);
          } catch {}
        }
      }
      for (const invite of oldInvites) {
        try {
          await calleeOld.decline(invite);
        } catch {}
      }
      caller.revoke();
      calleeOld.revoke();
      calleeNew.revoke();
    }
  }, 60000);
});
