import { describe, expect, test } from "vitest";

import DTMF from "../src/dtmf.js";

describe("DTMF", () => {
  test.each(["0", "9", "*", "#"])("accepts %s", (char) => {
    expect(DTMF.charToPayloads(char)).toHaveLength(6);
  });

  test("uses the first character at runtime", () => {
    expect(DTMF.charToPayloads("1oops")).toEqual(DTMF.charToPayloads("1"));
    expect(DTMF.charToPayloads("##")).toEqual(DTMF.charToPayloads("#"));
  });

  test.each(["", "A"])("rejects %j", (char) => {
    expect(() => DTMF.charToPayloads(char)).toThrow("invalid phone char");
  });
});
