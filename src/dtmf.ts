const phoneChars = [
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
export type DtmfChar = (typeof phoneChars)[number];

const payloads = [
  0x00060000, 0x000600a0, 0x00060140, 0x00860320, 0x00860320, 0x00860320,
];

const DTMF = {
  phoneChars,
  charToPayloads(char: string) {
    const index = phoneChars.indexOf(char[0] as (typeof phoneChars)[number]);
    if (index === -1) {
      throw new Error("invalid phone char");
    }
    return payloads.map((payload) => {
      const buffer = Buffer.alloc(4);
      buffer.writeIntBE(payload + index * 0x01000000, 0, 4);
      return buffer;
    });
  },
  payloadToChar(payload: Buffer) {
    const intBE = payload.readIntBE(0, 4);
    const index = (intBE - 0x00060000) / 0x01000000;
    return phoneChars[index];
  },
};

export default DTMF;
