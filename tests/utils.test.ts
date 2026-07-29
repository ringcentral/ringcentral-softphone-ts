import { describe, expect, test } from "vitest";

import { generateAuthorization } from "../src/utils.js";

describe("generateAuthorization", () => {
  test("generates the expected digest authorization", () => {
    expect(
      generateAuthorization(
        {
          authorizationId: "alice",
          domain: "sip.example.com",
          outboundProxy: "proxy.example.com:5061",
          password: "secret",
          username: "16505550100",
        },
        "nonce-123",
        "REGISTER",
      ),
    ).toBe(
      'Digest algorithm="MD5", username="alice", realm="sip.example.com", nonce="nonce-123", uri="sip:sip.example.com", response="f0ef3d1e899efd8a08f6a73722838994"',
    );
  });
});
