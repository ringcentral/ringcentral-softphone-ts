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
exports.defaultProtocols = void 0;
exports.createSDPAnswer = createSDPAnswer;
const sip_message_1 = require("../sip-message");
const utils_1 = require("../utils");
const _1 = __importDefault(require("."));
exports.defaultProtocols = [
    { id: 0, rtpmap: 'pcmu/8000' },
    { id: 9, rtpmap: 'g722/8000' },
    // { id: 8, rtpmap: 'pcma/8000' },
    { id: 101, rtpmap: 'telephone-event/8000', fmtp: '0-15' },
    { id: 103, rtpmap: 'telephone-event/16000', fmtp: '0-15' },
];
function createSDPAnswer(protocols = exports.defaultProtocols, client = 'rc-ssoftphone-ts') {
    const protocolIDs = protocols.map(p => p.id).join(' ');
    const attributes = protocols.map(p => `a=rtpmap:${p.id} ${p.rtpmap}` + (p.fmtp ? `\na=fmtp:${p.id} ${p.fmtp}` : '')).join('\n');
    return `
v=0
o=- ${(0, utils_1.randomInt)()} 0 IN IP4 127.0.0.1
s=${client}
c=IN IP4 127.0.0.1
t=0 0
m=audio ${(0, utils_1.randomInt)()} RTP/AVP ${protocolIDs}
a=sendrecv
${attributes}`.trim();
}
class InboundCallSession extends _1.default {
    constructor(softphone, inviteMessage) {
        super(softphone, inviteMessage);
        this.localPeer = inviteMessage.headers.To;
        this.remotePeer = inviteMessage.headers.From;
    }
    answer(protocols, client) {
        return __awaiter(this, void 0, void 0, function* () {
            const answerSDP = createSDPAnswer(protocols, client);
            //     const answerSDP = `
            // v=0
            // o=- ${randomInt()} 0 IN IP4 127.0.0.1
            // s=rc-softphone-ts
            // c=IN IP4 127.0.0.1
            // t=0 0
            // m=audio ${randomInt()} RTP/AVP 0 8 9 101 103
            // a=sendrecv
            // a=rtpmap:0 PCMU/8000
            // a=rtpmap:8 pcma/8000
            // a=rtpmap:9 g722/8000
            // a=rtpmap:101 telephone-event/8000
            // a=fmtp:101 0-15
            // a=rtpmap:103 telephone-event/16000
            // a=fmtp:103 0-15
            // `.trim();
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