"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class SipMessage {
    constructor(subject = '', headers = {}, body = '') {
        this.subject = subject;
        this.headers = headers;
        this.body = body
            .trim()
            .split(/[\r\n]+/)
            .join('\r\n');
        if (this.body.length > 0) {
            this.body += '\r\n';
        }
    }
    toString() {
        const r = [
            this.subject,
            ...Object.keys(this.headers).map((key) => `${key}: ${this.headers[key]}`),
            '',
            this.body,
        ].join('\r\n');
        return r;
    }
}
exports.default = SipMessage;
//# sourceMappingURL=sip-message.js.map