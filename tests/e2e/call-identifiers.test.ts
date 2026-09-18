import { once } from "node:events";
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

const SCENARIO_DEADLINE_MS = 60_000;
const REGISTRATION_PHASE_DEADLINE_MS = 15_000;
const CALL_PHASE_DEADLINE_MS = 20_000;
const ASSERTION_PHASE_DEADLINE_MS = 1_000;
const DISPOSAL_PHASE_DEADLINE_MS = 20_000;

const forceDisposeSession = (session: CallSession | OutboundCallSession) => {
  try {
    void session.hangup();
  } catch {}
  (session as unknown as { media: { dispose(): boolean } }).media.dispose();
};

const isNonEmptyTrimmedString = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

describe("E2E outbound call identifiers", () => {
  test("an answered real-server A-to-B call exposes non-empty public sessionId and partyId on A's outbound session", async () => {
    const callerOptions = sipConfigFromPrefix("SIP_A");
    const calleeOptions = sipConfigFromPrefix("SIP_B");
    const caller = new Softphone(callerOptions);
    const callee = new Softphone(calleeOptions);

    let outboundSession: OutboundCallSession | undefined;
    let inboundSession: CallSession | undefined;
    let answeredInvite: InboundInvite | undefined;
    let callerRegistered = false;
    let calleeRegistered = false;
    let callerAnswered = false;
    let calleeAnswered = false;
    let outboundWasDisposed = false;
    let inboundWasDisposed = false;
    let sessionIdPresent = false;
    let partyIdPresent = false;

    // B's invite observer is armed before registration and before the call is
    // placed, so an early invite cannot be missed. Invites are retained for
    // best-effort cleanup on failure.
    const invites: InboundInvite[] = [];
    let notifyInvite: (() => void) | undefined;
    const inviteArrivedPromise = new Promise<void>((resolve) => {
      notifyInvite = resolve;
    });
    callee.on("invite", (invite) => {
      invites.push(invite);
      notifyInvite?.();
    });

    const scenarioStart = Date.now();

    // Diagnostics are sanitized: phases, presence booleans, answer/disposal
    // state, and elapsed time only. Identifier values, SIP identities,
    // credentials, and network addresses are never printed.
    const describeFailure = (phase: string) =>
      [
        `outbound identifier scenario failed in phase "${phase}"`,
        `elapsed ${Date.now() - scenarioStart} ms of the ${SCENARIO_DEADLINE_MS} ms scenario deadline`,
        `registrations completed: A: ${callerRegistered}, B: ${calleeRegistered}`,
        `invite count received by B: ${invites.length}`,
        `answer state: A answered: ${callerAnswered}, B answered: ${calleeAnswered}`,
        `identifier presence on A's outbound session: sessionId: ${sessionIdPresent}, partyId: ${partyIdPresent}`,
        `disposal state: A outbound leg disposed: ${outboundWasDisposed}, B inbound leg disposed: ${inboundWasDisposed}`,
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
      await boundedPhase(
        "registering A",
        REGISTRATION_PHASE_DEADLINE_MS,
        async () => {
          await caller.register();
          callerRegistered = true;
        },
      );
      await boundedPhase(
        "registering B",
        REGISTRATION_PHASE_DEADLINE_MS,
        async () => {
          await callee.register();
          calleeRegistered = true;
        },
      );

      const outbound = await boundedPhase(
        "placing the outbound call from A",
        CALL_PHASE_DEADLINE_MS,
        () => caller.call(calleeOptions.username),
      );
      outboundSession = outbound;

      // A's answered observer is armed before B answers, so the early event
      // cannot be missed.
      const answeredPromise = once(outbound, "answered").then(() => {
        callerAnswered = true;
      });

      await boundedPhase(
        "awaiting B invite receipt",
        CALL_PHASE_DEADLINE_MS,
        async () => {
          await inviteArrivedPromise;
          expect(invites.length, "B must receive the invite").toBeGreaterThan(
            0,
          );
        },
      );

      const inbound = await boundedPhase(
        "answering on B",
        CALL_PHASE_DEADLINE_MS,
        async () => {
          const session = await callee.answer(invites[0]);
          answeredInvite = invites[0];
          inboundSession = session;
          calleeAnswered = true;
          return session;
        },
      );

      // Both B's answer operation and A's answered event must complete before
      // the identifier assertions.
      await boundedPhase(
        "awaiting A answered after B's answer completed",
        CALL_PHASE_DEADLINE_MS,
        () => answeredPromise,
      );

      await boundedPhase(
        "asserting A's public sessionId and partyId",
        ASSERTION_PHASE_DEADLINE_MS,
        async () => {
          const sessionIdIsNonEmptyString = isNonEmptyTrimmedString(
            outbound.sessionId,
          );
          const partyIdIsNonEmptyString = isNonEmptyTrimmedString(
            outbound.partyId,
          );
          sessionIdPresent = sessionIdIsNonEmptyString;
          partyIdPresent = partyIdIsNonEmptyString;
          expect(
            sessionIdIsNonEmptyString,
            "A's outbound session must expose a non-empty public sessionId after an answered real call",
          ).toBe(true);
          expect(
            partyIdIsNonEmptyString,
            "A's outbound session must expose a non-empty public partyId after an answered real call",
          ).toBe(true);
        },
      );

      await boundedPhase(
        "hanging up and awaiting disposal of both legs",
        DISPOSAL_PHASE_DEADLINE_MS,
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
      // Best-effort cleanup of any unexpected or unanswered invite before
      // revoking, without masking the original failure.
      for (const invite of invites) {
        if (invite !== answeredInvite) {
          try {
            await callee.decline(invite);
          } catch {}
        }
      }
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
