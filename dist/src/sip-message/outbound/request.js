"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = __importDefault(require("."));
const utils_1 = require("../../utils");
let cseq = Math.floor(Math.random() * 10000);
class RequestMessage extends _1.default {
    constructor(subject = '', headers = {}, body = '') {
        super(subject, headers, body);
        if (this.headers.CSeq === undefined) {
            this.newCseq();
        }
    }
    newCseq() {
        this.headers.CSeq = `${++cseq} ${this.subject.split(' ')[0]}`;
    }
    fork() {
        const newMessage = new RequestMessage(this.subject, Object.assign({}, this.headers), this.body);
        newMessage.newCseq();
        if (newMessage.headers.Via) {
            newMessage.headers.Via = newMessage.headers.Via.replace(/;branch=.+?$/, `;branch=${(0, utils_1.branch)()}`);
        }
        return newMessage;
    }
}
exports.default = RequestMessage;
//# sourceMappingURL=request.js.map