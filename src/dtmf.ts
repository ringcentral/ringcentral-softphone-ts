import { Buffer } from "node:buffer";

const PHONE_CHARS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "*",
  "#",
] as const;

export type DTMFChar = (typeof PHONE_CHARS)[number];

const VALID_DTMF_SET = new Set<string>(PHONE_CHARS);

export function isDTMFChar(char: string): char is DTMFChar {
  return VALID_DTMF_SET.has(char);
}

class DTMF {
  public static readonly phoneChars = PHONE_CHARS;

  private static readonly payloads = [
    0x00060000,
    0x000600a0,
    0x00060140,
    0x00860320,
    0x00860320,
    0x00860320,
  ];

  public static charToPayloads = (char: DTMFChar) => {
    const index = DTMF.phoneChars.indexOf(char);
    return DTMF.payloads.map((payload) => {
      const temp = payload + index * 0x01000000;
      const buffer = Buffer.alloc(4);
      buffer.writeIntBE(temp, 0, 4);
      return buffer;
    });
  };

  public static payloadToChar = (payload: Buffer): DTMFChar | undefined => {
    const intBE = payload.readIntBE(0, 4);
    const index = Math.floor((intBE - 0x00060000) / 0x01000000);
    if (index < 0 || index >= DTMF.phoneChars.length) {
      return undefined;
    }
    return DTMF.phoneChars[index];
  };
}

export default DTMF;
