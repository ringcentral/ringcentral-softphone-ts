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

const createTransport = (request = vi.fn(async () => ok)) =>
  Object.assign(new EventEmitter(), {
    localAddress: "192.0.2.1",
    localPort: 5061,
    ready: vi.fn(async () => {}),
    request,
    send: vi.fn(),
    dispose: vi.fn(),
  });

const flush = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
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
    const registrationErrors: Error[] = [];
    softphone.on("registrationError", (error) =>
      registrationErrors.push(error),
    );
    await softphone.register();

    const error = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    original.emit("disconnected", error);
    await flush();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(replacement.request).toHaveBeenCalledOnce();
    expect(softphone.signaling).toBe(replacement);
    expect(registrationErrors).toEqual([error]);
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
    softphone.on("registrationError", () => {});
    await softphone.register();

    original.emit("disconnected", new Error("disconnected"));
    await flush();
    expect(connect).toHaveBeenCalledTimes(2);

    for (const [index, seconds] of [1, 2, 4, 8, 16, 30, 30].entries()) {
      await vi.advanceTimersByTimeAsync(seconds * 1000);
      expect(connect).toHaveBeenCalledTimes(index + 3);
    }
    expect(
      failed
        .slice(0, 7)
        .every((transport) => transport.dispose.mock.calls.length === 1),
    ).toBe(true);
    softphone.revoke();
  });

  test("does not recover an initial registration failure", async () => {
    const initial = createTransport(
      vi.fn(async () => Promise.reject(new Error("SIP/2.0 503"))),
    );
    connect.mockReturnValue(initial);
    const softphone = new Softphone(options);

    await expect(softphone.register()).rejects.toThrow("SIP/2.0 503");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledOnce();
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
    softphone.on("registrationError", () => {});
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
    softphone.on("registrationError", () => {});
    await softphone.register();

    original.emit("disconnected", new Error("disconnected"));
    await flush();
    softphone.revoke();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(failed.dispose).toHaveBeenCalledOnce();
  });
});
