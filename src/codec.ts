import { Decoder, Encoder } from "@evan/opus";

const createOpusEncoder = (channels: 1 | 2, sampleRate: 16000 | 48000) => {
  const encoder = new Encoder({ channels, sample_rate: sampleRate });
  return { encode: (pcm: Buffer) => Buffer.from(encoder.encode(pcm)) };
};

const createOpusDecoder = (channels: 1 | 2, sampleRate: 16000 | 48000) => {
  const decoder = new Decoder({ channels, sample_rate: sampleRate });
  return { decode: (opus: Buffer) => Buffer.from(decoder.decode(opus)) };
};

class Codec {
  id: number;
  name: "OPUS/16000" | "OPUS/48000/2" | "PCMU/8000";
  packetSize: number;
  timestampInterval: number;
  createEncoder: () => { encode: (pcm: Buffer) => Buffer };
  createDecoder: () => { decode: (audio: Buffer) => Buffer };
  constructor(name: "OPUS/16000" | "OPUS/48000/2" | "PCMU/8000") {
    this.name = name;
    switch (name) {
      case "OPUS/16000":
        this.createEncoder = () => createOpusEncoder(1, 16000);
        this.createDecoder = () => createOpusDecoder(1, 16000);
        this.id = 109;
        this.packetSize = 640;
        this.timestampInterval = 320;
        break;
      case "OPUS/48000/2":
        this.createEncoder = () => createOpusEncoder(2, 48000);
        this.createDecoder = () => createOpusDecoder(2, 48000);
        this.id = 111;
        this.packetSize = 3840;
        this.timestampInterval = 960;
        break;
      case "PCMU/8000":
        this.createEncoder = () => ({ encode: (pcm: Buffer) => pcm });
        this.createDecoder = () => ({ decode: (audio: Buffer) => audio });
        this.id = 0;
        this.packetSize = 160;
        this.timestampInterval = 160;
        break;
      default:
        throw new Error(`unsupported codec: ${name}`);
    }
  }
}

export default Codec;
