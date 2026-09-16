import { describe, expect, test } from "vitest";

import { decodeMulawToPcm, encodePcmToMulaw } from "./mu-law.js";

const pcmBuffer = (samples: number[]) => {
  const pcm = Buffer.alloc(samples.length * 2);
  for (const [index, sample] of samples.entries()) {
    pcm.writeInt16LE(sample, index * 2);
  }
  return pcm;
};

const ulawBuffer = (bytes: number[]) => Buffer.from(bytes);

describe("G.711 mu-law conversion", () => {
  test("encodes representative linear samples to standard mu-law bytes", () => {
    expect(
      encodePcmToMulaw(
        pcmBuffer([
          0, 8, -8, 120, -120, 496, -496, 32124, -32124, 32635, -32635, 32767,
          -32768,
        ]),
      ),
    ).toEqual(
      ulawBuffer([
        0xff, 0xfe, 0x7e, 0xf0, 0x70, 0xdc, 0x5c, 0x80, 0x00, 0x80, 0x00, 0x80,
        0x00,
      ]),
    );
  });

  test("decodes representative mu-law bytes to standard linear samples", () => {
    expect(
      decodeMulawToPcm(
        ulawBuffer([
          0xff, 0x7f, 0xfe, 0x7e, 0xfd, 0x7d, 0xf0, 0x70, 0x80, 0x00, 0x81,
          0x01,
        ]),
      ),
    ).toEqual(
      pcmBuffer([
        0, 0, 8, -8, 16, -16, 120, -120, 32124, -32124, 31100, -31100,
      ]),
    );
  });

  test("round-trips representable samples within one quantization half-step", () => {
    for (let sample = -32635; sample <= 32635; sample += 997) {
      const decoded = decodeMulawToPcm(
        encodePcmToMulaw(pcmBuffer([sample])),
      ).readInt16LE(0);
      expect(
        Math.abs(decoded - sample),
        `sample ${sample} round-tripped to ${decoded}`,
      ).toBeLessThanOrEqual(512);
    }
  });

  test("converts buffers at the 2:1 mu-law byte ratio", () => {
    const ulaw = encodePcmToMulaw(pcmBuffer([0, 100, -100]));
    expect(ulaw.length).toBe(3);
    expect(decodeMulawToPcm(ulaw).length).toBe(6);
  });
});
