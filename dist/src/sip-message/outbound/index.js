"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sip_message_1 = __importDefault(require("../sip-message"));
class OutboundMessage extends sip_message_1.default {
    constructor(subject = '', headers = {}, body = '') {
        super(subject, headers, body);
        this.headers['Content-Length'] = this.body.length.toString();
        this.headers['User-Agent'] = 'ringcentral-softphone-ts';
        this.headers['Max-Forwards'] = '70';
    }
}
exports.default = OutboundMessage;
//# sourceMappingURL=index.js.map