import { once } from "node:events";
import { expect, test } from "vitest";

import Softphone, {
  type CallSession,
  type InboundInvite,
  type OutboundCallSession,
  type SoftphoneOptions,
} from "../../src/index.js";
import { InboundMessage } from "../../src/sip-message.js";

const requiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
};

const sipConfig = (prefix: "SIP_A" | "SIP_B"): SoftphoneOptions => ({
  outboundProxy: requiredEnv(`${prefix}_OUTBOUND_PROXY`),
  username: requiredEnv(`${prefix}_USERNAME`),
  password: requiredEnv(`${prefix}_PASSWORD`),
  authorizationId: requiredEnv(`${prefix}_AUTHORIZATION_ID`),
  domain: requiredEnv(`${prefix}_DOMAIN`),
});

const createSoftphones = () => {
  const aOptions = sipConfig("SIP_A");
  const bOptions = sipConfig("SIP_B");
  const a = new Softphone(aOptions);
  try {
    return { a, b: new Softphone(bOptions), bOptions };
  } catch (error) {
    a.revoke();
    throw error;
  }
};

const bounded = async <T>(phase: string, operation: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${phase} timed out`)),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const matches = (response: InboundMessage, request: InboundMessage) =>
  response.statusCode !== undefined &&
  response.callId === request.callId &&
  response.cseqNumber === request.cseqNumber &&
  response.cseqMethod === request.cseqMethod;

const observe = (softphone: Softphone) => {
  const incoming: InboundMessage[] = [];
  const outgoing: InboundMessage[] = [];
  softphone.on("message", (message: InboundMessage) => incoming.push(message));
  softphone.on("outboundMessage", (message: string) =>
    outgoing.push(InboundMessage.fromString(message)),
  );
  return { incoming, outgoing };
};

const cleanupSession = async (session: CallSession | undefined) => {
  if (!session) return;
  try {
    await session.hangup();
  } catch {
    // A local send failure must not leave the test's UDP socket open.
    (session as unknown as { media: { dispose(): void } }).media.dispose();
  }
};

test("ordinary caller cancellation ends B's pending invitation before answering", async () => {
  const { a, b, bOptions } = createSoftphones();
  const wire = observe(b);
  let outbound: OutboundCallSession | undefined;
  let invitation: InboundInvite | undefined;
  let answered = false;
  let canceled = false;
  let outboundDisposed = false;
  let cancellationReplies: InboundMessage[] = [];
  const invite = new Promise<InboundInvite>((resolve) =>
    b.once("invite", resolve),
  ).then((value) => {
    invitation = value;
    return value;
  });
  const cancellation = new Promise<InboundInvite>((resolve) =>
    b.once("inviteCanceled", (value) => {
      cancellationReplies = wire.outgoing.slice();
      resolve(value);
    }),
  ).then((value) => {
    canceled = true;
    expect(
      value === invitation,
      "cancellation carries original invitation",
    ).toBe(true);
    const replies = cancellationReplies.filter((message) =>
      ["CANCEL", "INVITE"].includes(message.cseqMethod ?? ""),
    );
    expect(
      replies.some(
        (message) =>
          message.cseqMethod === "CANCEL" && message.statusCode === 200,
      ),
    ).toBe(true);
    expect(
      replies.some(
        (message) =>
          message.cseqMethod === "INVITE" && message.statusCode === 487,
      ),
    ).toBe(true);
    const terminal = replies.filter(
      (message) => message.statusCode === 200 || message.statusCode === 487,
    );
    expect(terminal.length).toBe(2);
    expect(terminal[0].getHeader("To") === terminal[1].getHeader("To")).toBe(
      true,
    );
    const original = wire.incoming.find(
      (message) => message.method === "INVITE",
    );
    expect(original !== undefined).toBe(true);
    expect(
      terminal.every(
        (reply) =>
          reply.callId === original!.callId &&
          reply.cseqNumber === original!.cseqNumber &&
          reply.getHeader("Via") === original!.getHeader("Via") &&
          reply.getHeader("From") === original!.getHeader("From") &&
          reply.getHeader("To") === original!.getHeader("To"),
      ),
      "cancellation replies retain original transaction identity",
    ).toBe(true);
  });
  void cancellation.catch(() => {});
  try {
    await bounded("registration", Promise.all([a.register(), b.register()]));
    outbound = await bounded("outbound call", a.call(bOptions.username));
    outbound.on("answered", () => {
      answered = true;
    });
    outbound.on("disposed", () => {
      outboundDisposed = true;
    });
    await bounded("incoming invitation", invite);
    // RingCentral may already have answered A's separate leg while B rings.
    if (answered) await outbound.hangup();
    else await outbound.cancel();
    await bounded("incoming cancellation", cancellation);
    await expect(b.answer(invitation!)).rejects.toThrow("pending");
    await expect(b.decline(invitation!)).rejects.toThrow("pending");
    console.log(
      "Incoming cancellation: CANCEL 200 and INVITE 487 before original-object inviteCanceled; obsolete answer/decline rejected.",
    );
  } finally {
    if (!outboundDisposed) await cleanupSession(outbound);
    if (invitation && !canceled) {
      try {
        await b.decline(invitation);
      } catch {}
    }
    a.revoke();
    b.revoke();
  }
}, 120_000);

test("A transfers its external call to B and B hangs up (signaling only)", async () => {
  const externalCallee = requiredEnv("ANOTHER_CALLEE_FOR_TESTING");
  const { a, b, bOptions } = createSoftphones();
  const aWire = observe(a);
  const bWire = observe(b);
  let outbound: OutboundCallSession | undefined;
  let transferred: CallSession | undefined;
  let invitation: InboundInvite | undefined;
  let bDisposed = false;
  let aDisposed = false;
  // Arm B before placing A's call; no automatic answer is installed on A.
  const invite = new Promise<InboundInvite>((resolve) =>
    b.once("invite", resolve),
  ).then((value) => {
    invitation = value;
    return value;
  });
  try {
    await bounded("registration", Promise.all([a.register(), b.register()]));
    outbound = await bounded("external call", a.call(externalCallee));
    const aEnding = once(outbound, "disposed").then(() => {
      aDisposed = true;
    });
    await bounded("external callee answer", once(outbound, "answered"));
    const transfer = outbound.transfer(bOptions.username);
    void transfer.catch(() => {});
    await bounded(
      "transferred invitation",
      Promise.race([invite, transfer.then(() => invite)]),
    );
    transferred = await bounded(
      "B answering transferred call",
      b.answer(invitation!),
    );
    transferred.on("disposed", () => {
      bDisposed = true;
    });
    await bounded("transfer outcome", transfer);

    const refer = aWire.outgoing.find((message) => message.method === "REFER");
    expect(refer !== undefined, "A sends REFER").toBe(true);
    await expect
      .poll(
        () =>
          aWire.incoming.some(
            (message) =>
              matches(message, refer!) &&
              message.statusCode! >= 200 &&
              message.statusCode! < 300,
          ),
        { timeout: 5_000, message: "REFER accepted" },
      )
      .toBe(true);
    const notifications = aWire.incoming.filter(
      (message) =>
        message.method === "NOTIFY" && message.callId === refer!.callId,
    );
    expect(notifications.length, "transfer NOTIFY received").toBeGreaterThan(0);
    for (const notification of notifications) {
      expect(
        aWire.outgoing.some(
          (reply) => matches(reply, notification) && reply.statusCode === 200,
        ),
        "NOTIFY receives 200",
      ).toBe(true);
    }
    expect(
      notifications.some((message) => /^SIP\/2\.0 2\d\d\b/m.test(message.body)),
      "successful terminal sipfrag",
    ).toBe(true);
    expect(bDisposed, "B remains connected until its hangup").toBe(false);
    await transferred.hangup();
    expect(bDisposed, "B's normal hangup disposes its session").toBe(true);
    await bounded("A's ordinary call ending", aEnding);
    expect(
      aWire.incoming.some((message) => message.method === "BYE"),
      "A receives remote BYE",
    ).toBe(true);
    for (const wire of [aWire, bWire]) {
      for (const bye of wire.incoming.filter(
        (message) => message.method === "BYE",
      )) {
        expect(
          wire.outgoing.some(
            (reply) => matches(reply, bye) && reply.statusCode === 200,
          ),
          "remote BYE receives 200",
        ).toBe(true);
      }
    }
    console.log(
      `Transfer signaling only: REFER accepted; ${notifications.length} NOTIFY request(s) acknowledged; terminal success resolved transfer; B answered and initiated hangup. No audio asserted.`,
    );
  } finally {
    if (transferred && !bDisposed) await cleanupSession(transferred);
    if (!aDisposed) await cleanupSession(outbound);
    if (invitation && !transferred) {
      try {
        await b.decline(invitation);
      } catch {}
    }
    a.revoke();
    b.revoke();
  }
}, 180_000);
