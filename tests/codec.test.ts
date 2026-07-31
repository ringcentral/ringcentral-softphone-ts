import { beforeEach, describe, expect, test, vi } from "vitest";

const { Decoder, Encoder } = vi.hoisted(() => ({
  Decoder: vi.fn(function (this: { decode: () => Uint8Array }) {
    this.decode = vi.fn(() => Uint8Array.of(4, 5, 6));
  }),
  Encoder: vi.fn(function (this: { encode: () => Uint8Array }) {
    this.encode = vi.fn(() => Uint8Array.of(1, 2, 3));
  }),
}));

vi.mock("@evan/opus", () => ({ Decoder, Encoder }));

import Codec from "../src/codec.js";

describe("Codec", () => {
  beforeEach(() => {
    Decoder.mockClear();
    Encoder.mockClear();
  });

  test.each([
    {
      name: "OPUS/16000" as const,
      id: 109,
      packetSize: 640,
      timestampInterval: 320,
      options: { channels: 1, sample_rate: 16000 },
    },
    {
      name: "OPUS/48000/2" as const,
      id: 111,
      packetSize: 3840,
      timestampInterval: 960,
      options: { channels: 2, sample_rate: 48000 },
    },
  ])("configures $name and creates fresh Opus instances", (expected) => {
    const { options, ...metadata } = expected;
    const codec = new Codec(expected.name);

    expect(codec).toMatchObject(metadata);

    const firstEncoder = codec.createEncoder();
    const secondEncoder = codec.createEncoder();
    const firstDecoder = codec.createDecoder();
    const secondDecoder = codec.createDecoder();

    expect(firstEncoder).not.toBe(secondEncoder);
    expect(firstDecoder).not.toBe(secondDecoder);
    expect(Encoder).toHaveBeenCalledTimes(2);
    expect(Encoder).toHaveBeenNthCalledWith(1, options);
    expect(Encoder).toHaveBeenNthCalledWith(2, options);
    expect(Decoder).toHaveBeenCalledTimes(2);
    expect(Decoder).toHaveBeenNthCalledWith(1, options);
    expect(Decoder).toHaveBeenNthCalledWith(2, options);
    const encoded = firstEncoder.encode(Buffer.alloc(1));
    const decoded = firstDecoder.decode(Buffer.alloc(1));
    expect(Buffer.isBuffer(encoded)).toBe(true);
    expect(Buffer.isBuffer(decoded)).toBe(true);
    expect(encoded).toEqual(Buffer.from([1, 2, 3]));
    expect(decoded).toEqual(Buffer.from([4, 5, 6]));
  });

  test("keeps PCMU as an identity codec", () => {
    const codec = new Codec("PCMU/8000");
    const audio = Buffer.from([1, 2, 3]);

    expect(codec).toMatchObject({
      name: "PCMU/8000",
      id: 0,
      packetSize: 160,
      timestampInterval: 160,
    });
    expect(codec.createEncoder().encode(audio)).toBe(audio);
    expect(codec.createDecoder().decode(audio)).toBe(audio);
    expect(Encoder).not.toHaveBeenCalled();
    expect(Decoder).not.toHaveBeenCalled();
  });
});
