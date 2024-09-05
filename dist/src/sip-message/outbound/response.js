"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = __importDefault(require("."));
const response_codes_1 = __importDefault(require("../response-codes"));
class ResponseMessage extends _1.default {
    // eslint-disable-next-line max-params
    constructor(inboundMessage, responseCode, headers = {}, body = '') {
        super(undefined, Object.assign({}, headers), body);
        this.subject = `SIP/2.0 ${responseCode} ${response_codes_1.default[responseCode]}`;
        const keys = ['Via', 'From', 'To', 'Call-Id', 'CSeq'];
        for (const key of keys) {
            if (inboundMessage.headers[key]) {
                this.headers[key] = inboundMessage.headers[key];
            }
        }
    }
}
exports.default = ResponseMessage;
//# sourceMappingURL=response.js.map