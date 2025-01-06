import { Decoder, Encoder } from "@evan/opus";

const encoder = new Encoder({ channels: 1, sample_rate: 16000 });
const decoder = new Decoder({ channels: 1, sample_rate: 16000 });

export const opus = {
  encode: (pcm: Buffer) => Buffer.from(encoder.encode(pcm)),
  decode: (opus: Buffer) => Buffer.from(decoder.decode(opus)),
};
