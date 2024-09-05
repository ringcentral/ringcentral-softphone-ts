"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class DTMF {
}
DTMF.phoneChars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];
DTMF.payloads = [0x00060000, 0x000600a0, 0x00060140, 0x00860320, 0x00860320, 0x00860320];
DTMF.charToPayloads = (char) => {
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
DTMF.payloadToChar = (payload) => {
    const intBE = payload.readIntBE(0, 4);
    const index = (intBE - 0x00060000) / 0x01000000;
    return DTMF.phoneChars[index];
};
exports.default = DTMF;
//# sourceMappingURL=dtmf.js.map