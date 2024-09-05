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
const _1 = __importDefault(require("."));
const utils_1 = require("../utils");
class OutboundCallSession extends _1.default {
    constructor(softphone, answerMessage) {
        super(softphone, answerMessage);
        this.localPeer = answerMessage.headers.From;
        this.remotePeer = answerMessage.headers.To;
        this.init();
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            // wait for user to answer the call
            const answerHandler = (message) => {
                if (message.headers.CSeq === this.sipMessage.headers.CSeq) {
                    this.softphone.off('message', answerHandler);
                    this.emit('answered');
                    const ackMessage = new sip_message_1.RequestMessage(`ACK ${(0, utils_1.extractAddress)(this.remotePeer)} SIP/2.0`, {
                        'Call-Id': this.callId,
                        From: this.localPeer,
                        To: this.remotePeer,
                        Via: this.sipMessage.headers.Via,
                        CSeq: this.sipMessage.headers.CSeq.replace(' INVITE', ' ACK'),
                    });
                    this.softphone.send(ackMessage);
                }
            };
            this.softphone.on('message', answerHandler);
            this.once('answered', () => __awaiter(this, void 0, void 0, function* () { return this.startLocalServices(); }));
        });
    }
    cancel() {
        return __awaiter(this, void 0, void 0, function* () {
            const requestMessage = new sip_message_1.RequestMessage(`CANCEL ${(0, utils_1.extractAddress)(this.remotePeer)} SIP/2.0`, {
                'Call-Id': this.callId,
                From: this.localPeer,
                To: (0, utils_1.withoutTag)(this.remotePeer),
                Via: this.sipMessage.headers.Via,
                CSeq: this.sipMessage.headers.CSeq.replace(' INVITE', ' CANCEL'),
            });
            this.softphone.send(requestMessage);
        });
    }
}
exports.default = OutboundCallSession;
//# sourceMappingURL=outbound.js.map