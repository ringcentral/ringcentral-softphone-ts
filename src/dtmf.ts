class DTMF {
  public static readonly phoneChars = [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '*',
    '#',
  ];
  private static readonly payloads = [
    0x00060000, 0x000600a0, 0x00060140, 0x00860320, 0x00860320, 0x00860320,
  ];

  public static charToPayloads = (char: string) => {
    const index = DTMF.phoneChars.indexOf(char[0]);
    if (index === -1) {
      throw new Error('invalid phone char');
    }
    return DTMF.payloads.map((payload) => {
      const temp = payload + index * 0x01000000;
      const buffer = Buffer.alloc(4);
      buffer.writeIntBE(temp, 0, 4);
      return buffer;
    });
  };

  public static payloadToChar = (payload: Buffer) => {
    const intBE = payload.readIntBE(0, 4);
    const index = (intBE - 0x00060000) / 0x01000000;
    return DTMF.phoneChars[index];
  };
}

export default DTMF;
