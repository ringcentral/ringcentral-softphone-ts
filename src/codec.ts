import { Decoder, Encoder } from '@evan/opus';

export type Opus = {
  encode: (pcm: Buffer) => Buffer;
  decode: (opus: Buffer) => Buffer;
};

export const createOpus = (
  channels: 1 | 2,
  sample_rate: 8000 | 12000 | 16000 | 24000 | 48000,
): Opus => {
  const encoder = new Encoder({ channels, sample_rate });
  const decoder = new Decoder({ channels, sample_rate });
  return {
    encode: (pcm: Buffer) => Buffer.from(encoder.encode(pcm)),
    decode: (opus: Buffer) => Buffer.from(decoder.decode(opus)),
  };
};
