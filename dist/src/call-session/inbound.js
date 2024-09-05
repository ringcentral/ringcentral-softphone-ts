"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sip_message_1 = require("../sip-message");
const utils_1 = require("../utils");
const _1 = __importDefault(require("."));
class InboundCallSession extends _1.default {
    constructor(softphone, inviteMessage) {
        super(softphone, inviteMessage);
        this.localPeer = inviteMessage.headers.To;
        this.remotePeer = inviteMessage.headers.From;
    }
    answer() {
        return __awaiter(this, void 0, void 0, function* () {
            const answerSDP = `
v=0
o=- ${(0, utils_1.randomInt)()} 0 IN IP4 127.0.0.1
s=rc-softphone-ts
c=IN IP4 127.0.0.1
t=0 0
m=audio ${(0, utils_1.randomInt)()} RTP/AVP 0 101
a=rtpmap:0 PCMU/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
a=sendrecv
`.trim();
            const newMessage = new sip_message_1.ResponseMessage(this.sipMessage, 200, {
                'Content-Type': 'application/sdp',
            }, answerSDP);
            this.softphone.send(newMessage);
            this.startLocalServices();
        });
    }
}
exports.default = InboundCallSession;
//# sourceMappingURL=inbound.js.map