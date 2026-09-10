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

const CALLER_SEQUENCE = "12#";
const CALLEE_SEQUENCE = "90*";
const INTER_CHARACTER_DELAY_MS = 500;
const EXCHANGE_DEADLINE_MS = 30_000;

const hangUpBestEffort = async (session: CallSession | undefined) => {
  if (session === undefined) {
    return;
  }
  try {
    await session.hangup();
  } catch {
    return;
  }
};

describe("E2E call DTMF", () => {
  test("caller and callee exchange simultaneous DTMF in a real call", async () => {
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
    let outboundSession: OutboundCallSession | undefined;
    let inboundSession: CallSession | undefined;
    let callFinished = false;

    try {
      await Promise.all([caller.register(), callee.register()]);

      const outbound = await caller.call(calleeOptions.username);
      outboundSession = outbound;
      const answeredPromise = once(outbound, "answered");
      const { session: inbound } = await inboundCallPromise;
      inboundSession = inbound;
      await answeredPromise;

      const callerReceived: string[] = [];
      const calleeReceived: string[] = [];
      outbound.on("dtmf", (char) => callerReceived.push(char));
      inbound.on("dtmf", (char) => calleeReceived.push(char));

      let callerSendFinished = false;
      let calleeSendFinished = false;
      const exchange = (async () => {
        await Promise.all([
          outbound
            .sendDTMFs(CALLER_SEQUENCE, INTER_CHARACTER_DELAY_MS)
            .then(() => {
              callerSendFinished = true;
            }),
          inbound
            .sendDTMFs(CALLEE_SEQUENCE, INTER_CHARACTER_DELAY_MS)
            .then(() => {
              calleeSendFinished = true;
            }),
        ]);
        expect(callerReceived.join("")).toBe(CALLEE_SEQUENCE);
        expect(calleeReceived.join("")).toBe(CALLER_SEQUENCE);
      })();

      let deadlineTimer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          reject(
            new Error(
              `simultaneous DTMF exchange did not complete within ${EXCHANGE_DEADLINE_MS} ms (caller send finished: ${callerSendFinished}, callee send finished: ${calleeSendFinished}, caller received: ${callerReceived.join("") || "none"}, callee received: ${calleeReceived.join("") || "none"})`,
            ),
          );
        }, EXCHANGE_DEADLINE_MS);
      });
      try {
        await Promise.race([exchange, deadline]);
      } finally {
        clearTimeout(deadlineTimer);
      }

      const outboundDisposed = once(outbound, "disposed");
      const inboundDisposed = once(inbound, "disposed");
      await outbound.hangup();
      await Promise.all([outboundDisposed, inboundDisposed]);
      callFinished = true;
    } finally {
      if (!callFinished) {
        await hangUpBestEffort(outboundSession);
        await hangUpBestEffort(inboundSession);
      }
      caller.revoke();
      callee.revoke();
    }
  }, 120000);
});
