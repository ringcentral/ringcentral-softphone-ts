const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

const encodeSample = (sample: number): number => {
  const sign = sample < 0 ? 0x80 : 0x00;
  const magnitude = Math.min(Math.abs(sample), MULAW_CLIP) + MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (magnitude & mask) === 0; ) {
    exponent -= 1;
    mask >>= 1;
  }
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
};

const decodeSample = (ulaw: number): number => {
  const value = ~ulaw & 0xff;
  const magnitude =
    (((value & 0x0f) << 3) + MULAW_BIAS) << ((value >> 4) & 0x07);
  return (value & 0x80) === 0 ? magnitude - MULAW_BIAS : MULAW_BIAS - magnitude;
};

export const encodePcmToMulaw = (pcm: Buffer): Buffer => {
  const ulaw = Buffer.alloc(Math.floor(pcm.length / 2));
  for (let index = 0; index < ulaw.length; index++) {
    ulaw.writeUInt8(encodeSample(pcm.readInt16LE(index * 2)), index);
  }
  return ulaw;
};

export const decodeMulawToPcm = (ulaw: Buffer): Buffer => {
  const pcm = Buffer.alloc(ulaw.length * 2);
  for (let index = 0; index < ulaw.length; index++) {
    pcm.writeInt16LE(decodeSample(ulaw.readUInt8(index)), index * 2);
  }
  return pcm;
};
