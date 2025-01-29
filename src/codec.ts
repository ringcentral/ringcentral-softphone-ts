import { Decoder, Encoder } from "@evan/opus";

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
      case "OPUS/16000": {
        this.createEncoder = () => {
          const encoder = new Encoder({ channels: 1, sample_rate: 16000 });
          return { encode: (pcm: Buffer) => Buffer.from(encoder.encode(pcm)) };
        };
        this.createDecoder = () => {
          const decoder = new Decoder({ channels: 1, sample_rate: 16000 });
          return {
            decode: (opus: Buffer) => Buffer.from(decoder.decode(opus)),
          };
        };
        this.id = 109;
        this.packetSize = 640;
        this.timestampInterval = 320;
        break;
      }
      case "OPUS/48000/2": {
        this.createEncoder = () => {
          const encoder = new Encoder({ channels: 2, sample_rate: 48000 });
          return { encode: (pcm: Buffer) => Buffer.from(encoder.encode(pcm)) };
        };
        this.createDecoder = () => {
          const decoder = new Decoder({ channels: 2, sample_rate: 48000 });
          return {
            decode: (opus: Buffer) => Buffer.from(decoder.decode(opus)),
          };
        };
        this.id = 111;
        this.packetSize = 3840;
        this.timestampInterval = 960;
        break;
      }
      case "PCMU/8000": {
        this.createEncoder = () => {
          return { encode: (pcm: Buffer) => pcm };
        };
        this.createDecoder = () => {
          return { decode: (audio: Buffer) => audio };
        };
        this.id = 0;
        this.packetSize = 160;
        this.timestampInterval = 160;
        break;
      }
      default: {
        throw new Error(`unsupported codec: ${name}`);
      }
    }
  }
}

export default Codec;
