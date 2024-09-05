declare class DTMF {
    static readonly phoneChars: string[];
    private static readonly payloads;
    static charToPayloads: (char: string) => Buffer[];
    static payloadToChar: (payload: Buffer) => string;
}
export default DTMF;
