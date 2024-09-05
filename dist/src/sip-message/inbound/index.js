"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../../utils");
const sip_message_1 = __importDefault(require("../sip-message"));
class InboundMessage extends sip_message_1.default {
    static fromString(str) {
        const sipMessage = new sip_message_1.default();
        const [init, ...body] = str.split('\r\n\r\n');
        sipMessage.body = body.join('\r\n\r\n');
        const [subject, ...headers] = init.split('\r\n');
        sipMessage.subject = subject;
        sipMessage.headers = Object.fromEntries(headers.map((line) => line.split(': ')));
        if (sipMessage.headers.To && !sipMessage.headers.To.includes(';tag=')) {
            sipMessage.headers.To += ';tag=' + (0, utils_1.uuid)(); // generate local tag
        }
        return sipMessage;
    }
}
exports.default = InboundMessage;
//# sourceMappingURL=index.js.map