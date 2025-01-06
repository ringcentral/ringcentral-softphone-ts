import { Decoder, Encoder } from "@evan/opus";

const encoder = new Encoder({ channels: 1, sample_rate: 16000 });
const decoder = new Decoder({ channels: 1, sample_rate: 16000 });

export const opus = {
  encode: (pcm: Buffer) => encoder.encode(pcm),
  decode: (opus: Buffer) => decoder.decode(opus),
};
