import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("node:tls", () => ({
  default: { connect },
  connect,
}));

import Softphone, { type SoftphoneOptions } from "../src/index.js";

const validOptions = (): SoftphoneOptions => ({
  domain: "sip.ringcentral.com",
  outboundProxy: "sip20.ringcentral.com:5096",
  username: "16505550100",
  password: "secret",
  authorizationId: "123456789",
});

const fakeSocket = () =>
  Object.assign(new EventEmitter(), {
    localAddress: "127.0.0.1",
    localPort: 12345,
    write: vi.fn(() => true),
    destroy: vi.fn(),
  });

describe("Softphone options", () => {
  beforeEach(() => {
    connect.mockReset();
    connect.mockImplementation(() => fakeSocket());
  });

  test("clones options and applies only codec and TLS defaults", () => {
    const options = validOptions();
    const softphone = new Softphone(options);

    expect(softphone).toBeInstanceOf(EventEmitter);
    expect(typeof softphone.removeAllListeners).toBe("function");
    expect(softphone.sipInfo).not.toBe(options);
    expect(softphone.sipInfo).toEqual({
      ...options,
      codec: "OPUS/16000",
      ignoreTlsCertErrors: false,
    });
    expect(options).toEqual(validOptions());

    const configured = new Softphone({
      ...options,
      codec: "PCMU/8000",
      ignoreTlsCertErrors: true,
    });
    expect(configured.sipInfo).toMatchObject({
      codec: "PCMU/8000",
      ignoreTlsCertErrors: true,
    });
  });

  test.each([
    "domain",
    "outboundProxy",
    "username",
    "password",
    "authorizationId",
  ] as const)("rejects a missing or blank %s before connecting", (key) => {
    const missing: Partial<SoftphoneOptions> = validOptions();
    delete missing[key];

    expect(() => new Softphone(missing as SoftphoneOptions)).toThrow(
      `${key} must not be blank`,
    );
    expect(() => new Softphone({ ...validOptions(), [key]: "  " })).toThrow(
      `${key} must not be blank`,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  test("requires a structurally plain domain without a port", () => {
    expect(
      () =>
        new Softphone({
          ...validOptions(),
          domain: "sip.ringcentral.com:5061",
        }),
    ).toThrow("domain must be a hostname without a port");
    expect(
      () =>
        new Softphone({
          ...validOptions(),
          domain: "sip.ringcentral.com/path",
        }),
    ).toThrow("domain must be a hostname without a port");
    expect(connect).not.toHaveBeenCalled();
  });

  test.each([
    "sip20.ringcentral.com",
    "sip20.ringcentral.com:not-a-port",
    "sip20.ringcentral.com:0",
    "sip20.ringcentral.com:65536",
    "sip20.ringcentral.com:5096/path",
  ])("rejects an invalid outbound proxy %s before connecting", (outboundProxy) => {
    expect(() => new Softphone({ ...validOptions(), outboundProxy })).toThrow(
      "outboundProxy must be a hostname and port",
    );
    expect(connect).not.toHaveBeenCalled();
  });

  test("does not impose custom DNS grammar", () => {
    new Softphone({
      ...validOptions(),
      domain: "internal_host",
      outboundProxy: "proxy_host:5096",
    });

    expect(connect).toHaveBeenCalled();
  });

  test("connects to a validated IPv6 proxy without splitting the address", () => {
    new Softphone({ ...validOptions(), outboundProxy: "[::1]:5096" });

    expect(connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: "::1", port: 5096 }),
      expect.any(Function),
    );
  });
});
