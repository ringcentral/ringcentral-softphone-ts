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
const events_1 = __importDefault(require("events"));
const dgram_1 = __importDefault(require("dgram"));
const werift_rtp_1 = require("werift-rtp");
const sip_message_1 = require("../sip-message");
const utils_1 = require("../utils");
const dtmf_1 = __importDefault(require("../dtmf"));
const streamer_1 = __importDefault(require("./streamer"));
class CallSession extends events_1.default {
    constructor(softphone, sipMessage) {
        super();
        this.disposed = false;
        this.softphone = softphone;
        this.sipMessage = sipMessage;
        this.remoteIP = this.sipMessage.body.match(/c=IN IP4 ([\d.]+)/)[1];
        this.remotePort = parseInt(this.sipMessage.body.match(/m=audio (\d+) /)[1], 10);
    }
    get callId() {
        return this.sipMessage.headers['Call-Id'];
    }
    send(data) {
        this.socket.send(data, this.remotePort, this.remoteIP);
    }
    transfer(target) {
        return __awaiter(this, void 0, void 0, function* () {
            const requestMessage = new sip_message_1.RequestMessage(`REFER sip:${(0, utils_1.extractAddress)(this.remotePeer)} SIP/2.0`, {
                'Call-Id': this.callId,
                From: this.localPeer,
                To: this.remotePeer,
                Via: `SIP/2.0/TCP ${this.softphone.fakeDomain};branch=${(0, utils_1.branch)()}`,
                'Refer-To': `sip:${target}@sip.ringcentral.com`,
                'Referred-By': `<${(0, utils_1.extractAddress)(this.localPeer)}>`,
            });
            this.softphone.send(requestMessage);
            // reply to those NOTIFY messages
            const notifyHandler = (inboundMessage) => {
                if (!inboundMessage.subject.startsWith('NOTIFY ')) {
                    return;
                }
                const responseMessage = new sip_message_1.ResponseMessage(inboundMessage, 200);
                this.softphone.send(responseMessage);
                if (inboundMessage.body.trim() === 'SIP/2.0 200 OK') {
                    this.softphone.off('message', notifyHandler);
                }
            };
            this.softphone.on('message', notifyHandler);
        });
    }
    hangup() {
        return __awaiter(this, void 0, void 0, function* () {
            const requestMessage = new sip_message_1.RequestMessage(`BYE sip:${this.softphone.sipInfo.domain} SIP/2.0`, {
                'Call-Id': this.callId,
                From: this.localPeer,
                To: this.remotePeer,
                Via: `SIP/2.0/TCP ${this.softphone.fakeDomain};branch=${(0, utils_1.branch)()}`,
            });
            this.softphone.send(requestMessage);
        });
    }
    sendDTMF(char) {
        return __awaiter(this, void 0, void 0, function* () {
            const timestamp = Math.floor(Date.now() / 1000);
            let sequenceNumber = timestamp % 65536;
            const rtpHeader = new werift_rtp_1.RtpHeader({
                version: 2,
                padding: false,
                paddingSize: 0,
                extension: false,
                marker: false,
                payloadOffset: 12,
                payloadType: 101,
                sequenceNumber,
                timestamp,
                ssrc: (0, utils_1.randomInt)(),
                csrcLength: 0,
                csrc: [],
                extensionProfile: 48862,
                extensionLength: undefined,
                extensions: [],
            });
            for (const payload of dtmf_1.default.charToPayloads(char)) {
                rtpHeader.sequenceNumber = sequenceNumber++;
                const rtpPacket = new werift_rtp_1.RtpPacket(rtpHeader, payload);
                this.send(rtpPacket.serialize());
            }
        });
    }
    // buffer is the content of a audio file, it is supposed to be PCMU/8000 encoded.
    // The audio should be playable by command: ffplay -autoexit -f mulaw -ar 8000 test.raw
    streamAudio(input, payloadType = 0) {
        const streamer = new streamer_1.default(this, input, payloadType);
        streamer.start();
        return streamer;
    }
    startLocalServices() {
        return __awaiter(this, void 0, void 0, function* () {
            this.socket = dgram_1.default.createSocket('udp4');
            this.socket.on('message', (message) => {
                const rtpPacket = werift_rtp_1.RtpPacket.deSerialize(message);
                this.emit('rtpPacket', rtpPacket);
                if (rtpPacket.header.payloadType === 101) {
                    this.emit('dtmfPacket', rtpPacket);
                    const char = dtmf_1.default.payloadToChar(rtpPacket.payload);
                    if (char) {
                        this.emit('dtmf', char);
                    }
                }
                else {
                    this.emit('audioPacket', rtpPacket);
                }
            });
            this.socket.bind();
            // send a message to remote server so that it knows where to reply
            this.send('hello');
            const byeHandler = (inboundMessage) => {
                if (inboundMessage.headers['Call-Id'] !== this.callId) {
                    return;
                }
                if (inboundMessage.headers.CSeq.endsWith(' BYE')) {
                    this.softphone.off('message', byeHandler);
                    this.dispose();
                }
            };
            this.softphone.on('message', byeHandler);
        });
    }
    dispose() {
        this.disposed = true;
        this.emit('disposed');
        this.removeAllListeners();
        this.socket.removeAllListeners();
        this.socket.close();
    }
}
exports.default = CallSession;
//# sourceMappingURL=index.js.map