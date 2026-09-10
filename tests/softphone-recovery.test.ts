import EventEmitter from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("../src/sip-transport.js", () => ({
  SipTransport: { connect },
}));

import Softphone, { type SoftphoneOptions } from "../src/index.js";
import { InboundMessage, RequestMessage } from "../src/sip-message.js";

const options: SoftphoneOptions = {
  domain: "example.com",
  outboundProxy: "proxy.example.com:5061",
  username: "1001",
  password: "secret",
  authorizationId: "1001",
};

const ok = new InboundMessage("SIP/2.0 200 OK");

const createTransport = (
  request = vi.fn(async () => ok),
  ready: (signal: AbortSignal) => Promise<void> = vi.fn(async () => {}),
) =>
  Object.assign(new EventEmitter(), {
    localAddress: "192.0.2.1",
    localPort: 5061,
    ready,
    request,
    send: vi.fn(),
    dispose: vi.fn(),
  });

const flush = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

beforeEach(() => {
  vi.useFakeTimers();
  connect.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Softphone signaling recovery", () => {
  test("immediately replaces and registers a failed established transport", async () => {
    const original = createTransport();
    const replacement = createTransport();
    connect.mockReturnValueOnce(original).mockReturnValueOnce(replacement);
    const softphone = new Softphone(options);
    const signalingErrors: Error[] = [];
    softphone.on("signalingError", (error) => signalingErrors.push(error));
    await softphone.register();

    const error = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    original.emit("disconnected", error);
    await flush();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(replacement.request).toHaveBeenCalledOnce();
    expect(softphone.signaling).toBe(replacement);
    expect(signalingErrors).toEqual([error]);
    softphone.revoke();
  });

  test("retries failed recovery with capped backoff", async () => {
    const original = createTransport();
    const failed = Array.from({ length: 8 }, (_, index) =>
      createTransport(
        vi.fn(async () => Promise.reject(new Error(`failure ${index}`))),
      ),
    );
    connect.mockReturnValueOnce(original);
    for (const transport of failed) connect.mockReturnValueOnce(transport);
    const softphone = new Softphone(options);
    const signalingErrors: Error[] = [];
    softphone.on("signalingError", (error) => signalingErrors.push(error));
    await softphone.register();

    original.emit("disconnected", new Error("disconnected"));
    await flush();
    expect(connect).toHaveBeenCalledTimes(2);

    for (const [index, seconds] of [1, 2, 4, 8, 16, 30, 30].entries()) {
      await vi.advanceTimersByTimeAsync(seconds * 1000);
      expect(connect).toHaveBeenCalledTimes(index + 3);
    }
    expect(signalingErrors).toHaveLength(9);
    expect(
      failed
        .slice(0, 7)
        .every((transport) => transport.dispose.mock.calls.length === 1),
    ).toBe(true);
    softphone.revoke();
  });

  test("times out replacement TLS readiness before retrying", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    const original = createTransport();
    const replacement = createTransport(
      undefined,
      vi.fn(
        (signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)),
          ),
      ),
    );
    const retry = createTransport();
    connect
      .mockReturnValueOnce(original)
      .mockReturnValueOnce(replacement)
      .mockReturnValueOnce(retry);
    const softphone = new Softphone(options);
    const errors: Error[] = [];
    softphone.on("signalingError", (error) => errors.push(error));
    await softphone.register();
    timeoutSpy.mockClear();

    original.emit("disconnected", new Error("disconnected"));
    await flush();
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(replacement.dispose).not.toHaveBeenCalled();
    timeout.abort();
    await flush();
    expect(replacement.dispose).toHaveBeenCalledOnce();
    expect(errors.at(-1)?.message).toBe(
      "Failed to register: connect to TLS timeout",
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(3);
    softphone.revoke();
  });

  test("reports a TLS-ready REGISTER failure and schedules a retry", async () => {
    const original = createTransport();
    const registerError = new Error("Failed to register: SIP/2.0 503");
    const failed = createTransport(
      vi.fn(async () => Promise.reject(registerError)),
    );
    const retry = createTransport();
    connect
      .mockReturnValueOnce(original)
      .mockReturnValueOnce(failed)
      .mockReturnValueOnce(retry);
    const softphone = new Softphone(options);
    const errors: Error[] = [];
    softphone.on("signalingError", (error) => errors.push(error));
    await softphone.register();

    original.emit("disconnected", new Error("disconnected"));
    await flush();

    expect(errors).toContain(registerError);
    expect(failed.dispose).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(3);
    softphone.revoke();
  });

  test("fails new signaling on the old transport while replacement REGISTER is pending", async () => {
    const original = createTransport();
    const registration = deferred<InboundMessage>();
    const replacement = createTransport(vi.fn(() => registration.promise));
    connect.mockReturnValueOnce(original).mockReturnValueOnce(replacement);
    const softphone = new Softphone(options);
    softphone.on("signalingError", () => {});
    await softphone.register();
    const error = new Error("read ECONNRESET");
    original.request.mockRejectedValue(error);

    original.emit("disconnected", error);
    await flush();
    const operation = softphone.signaling.request(
      new RequestMessage("OPTIONS sip:example.com SIP/2.0"),
    );

    await expect(operation).rejects.toBe(error);
    expect(replacement.request).toHaveBeenCalledOnce();
    registration.resolve(ok);
    await flush();
    expect(replacement.request).toHaveBeenCalledOnce();
    softphone.revoke();
  });

  test("does not reconnect for a valid SIP 503 on the established transport", async () => {
    const unavailable = new InboundMessage("SIP/2.0 503 Service Unavailable");
    const original = createTransport(
      vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(unavailable),
    );
    connect.mockReturnValue(original);
    const softphone = new Softphone(options);
    const errors: Error[] = [];
    softphone.on("signalingError", (error) => errors.push(error));
    await softphone.register();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(errors.at(-1)?.message).toBe(
      "Failed to register: SIP/2.0 503 Service Unavailable",
    );
    expect(connect).toHaveBeenCalledOnce();
    softphone.revoke();
  });

  test("coalesces duplicate disconnect notifications into one recovery", async () => {
    const original = createTransport();
    const replacement = createTransport();
    connect.mockReturnValueOnce(original).mockReturnValueOnce(replacement);
    const softphone = new Softphone(options);
    softphone.on("signalingError", () => {});
    await softphone.register();

    original.emit("disconnected", new Error("error"));
    original.emit("disconnected", new Error("close"));
    await flush();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(replacement.request).toHaveBeenCalledOnce();
    softphone.revoke();
  });

  test("does not recover an initial registration failure", async () => {
    const initial = createTransport(
      vi.fn(async () => Promise.reject(new Error("SIP/2.0 503"))),
    );
    connect.mockReturnValue(initial);
    const softphone = new Softphone(options);
    const signalingErrors: Error[] = [];
    softphone.on("signalingError", (error) => signalingErrors.push(error));

    await expect(softphone.register()).rejects.toThrow("SIP/2.0 503");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledOnce();
    expect(signalingErrors).toEqual([]);
    softphone.revoke();
  });

  test("rejects and never replays an interrupted request", async () => {
    let rejectRequest!: (error: Error) => void;
    const original = createTransport(
      vi
        .fn()
        .mockResolvedValueOnce(ok)
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectRequest = reject;
            }),
        ),
    );
    const replacement = createTransport();
    connect.mockReturnValueOnce(original).mockReturnValueOnce(replacement);
    const softphone = new Softphone(options);
    softphone.on("signalingError", () => {});
    await softphone.register();
    const interrupted = softphone.signaling.request(
      new RequestMessage("OPTIONS sip:example.com SIP/2.0"),
    );

    const error = new Error("read ECONNRESET");
    original.once("disconnected", () => rejectRequest(error));
    original.emit("disconnected", error);
    await expect(interrupted).rejects.toBe(error);
    await flush();

    expect(replacement.request).toHaveBeenCalledOnce();
    softphone.revoke();
  });

  test("revocation cancels delayed recovery", async () => {
    const original = createTransport();
    const failed = createTransport(
      vi.fn(async () => Promise.reject(new Error("still unavailable"))),
    );
    connect.mockReturnValueOnce(original).mockReturnValueOnce(failed);
    const softphone = new Softphone(options);
    softphone.on("signalingError", () => {});
    await softphone.register();

    original.emit("disconnected", new Error("disconnected"));
    await flush();
    softphone.revoke();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(failed.dispose).toHaveBeenCalledOnce();
  });

  test.each(["connecting", "registering"])(
    "revocation during replacement %s prevents adoption and retries",
    async (stage) => {
      const original = createTransport();
      const pending = deferred<void>();
      const replacement =
        stage === "connecting"
          ? createTransport(
              undefined,
              vi.fn(() => pending.promise),
            )
          : createTransport(vi.fn(() => pending.promise.then(() => ok)));
      connect.mockReturnValueOnce(original).mockReturnValueOnce(replacement);
      const softphone = new Softphone(options);
      const signalingErrors: Error[] = [];
      softphone.on("signalingError", (error) => signalingErrors.push(error));
      await softphone.register();

      const disconnect = new Error("disconnected");
      original.emit("disconnected", disconnect);
      await flush();
      softphone.revoke();
      pending.resolve();
      await flush();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(signalingErrors).toEqual([disconnect]);
      expect(replacement.dispose).toHaveBeenCalledOnce();
      expect(softphone.signaling).toBe(original);
      expect(connect).toHaveBeenCalledTimes(2);
    },
  );

  test("ignores stale recovery failure after revocation", async () => {
    const original = createTransport();
    const registration = deferred<InboundMessage>();
    const replacement = createTransport(vi.fn(() => registration.promise));
    connect.mockReturnValueOnce(original).mockReturnValueOnce(replacement);
    const softphone = new Softphone(options);
    const errors: Error[] = [];
    softphone.on("signalingError", (error) => errors.push(error));
    await softphone.register();

    const disconnected = new Error("disconnected");
    original.emit("disconnected", disconnected);
    await flush();
    softphone.revoke();
    registration.reject(new Error("stale registration failure"));
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(softphone.signaling).toBe(original);
    expect(errors).toEqual([disconnected]);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  test("successful recovery resets backoff and resumes registration refresh", async () => {
    const original = createTransport();
    const failedOnce = createTransport(
      vi.fn(async () => Promise.reject(new Error("failure"))),
    );
    const recovered = createTransport();
    const failedAgain = createTransport(
      vi.fn(async () => Promise.reject(new Error("failure again"))),
    );
    const recoveredAgain = createTransport();
    connect
      .mockReturnValueOnce(original)
      .mockReturnValueOnce(failedOnce)
      .mockReturnValueOnce(recovered)
      .mockReturnValueOnce(failedAgain)
      .mockReturnValueOnce(recoveredAgain);
    const softphone = new Softphone(options);
    softphone.on("signalingError", () => {});
    await softphone.register();

    original.emit("disconnected", new Error("first outage"));
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(softphone.signaling).toBe(recovered);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(recovered.request).toHaveBeenCalledTimes(2);

    recovered.emit("disconnected", new Error("second outage"));
    await flush();
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(5);
    expect(softphone.signaling).toBe(recoveredAgain);
    softphone.revoke();
  });
});
