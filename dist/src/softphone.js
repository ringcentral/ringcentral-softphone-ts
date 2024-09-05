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
const net_1 = __importDefault(require("net"));
const wait_for_async_1 = __importDefault(require("wait-for-async"));
const sip_message_1 = require("./sip-message");
const utils_1 = require("./utils");
const inbound_1 = __importDefault(require("./call-session/inbound"));
const outbound_1 = __importDefault(require("./call-session/outbound"));
class Softphone extends events_1.default {
    constructor(sipInfo) {
        super();
        this.fakeDomain = (0, utils_1.uuid)() + '.invalid';
        this.fakeEmail = (0, utils_1.uuid)() + '@' + this.fakeDomain;
        this.connected = false;
        this.sipInfo = sipInfo;
        if (this.sipInfo.domain === undefined) {
            this.sipInfo.domain = 'sip.ringcentral.com';
        }
        if (this.sipInfo.outboundProxy === undefined) {
            this.sipInfo.outboundProxy = 'sip112-1241.ringcentral.com:5091';
        }
        this.client = new net_1.default.Socket();
        const tokens = this.sipInfo.outboundProxy.split(':');
        this.client.connect(parseInt(tokens[1], 10), tokens[0], () => {
            this.connected = true;
        });
        let cache = '';
        this.client.on('data', (data) => {
            cache += data.toString('utf-8');
            if (!cache.endsWith('\r\n')) {
                return; // haven't received a complete message yet
            }
            // received two empty body messages
            const tempMessages = cache.split('\r\nContent-Length: 0\r\n\r\n').filter((message) => message.trim() !== '');
            cache = '';
            for (let i = 0; i < tempMessages.length; i++) {
                if (!tempMessages[i].includes('Content-Length: ')) {
                    tempMessages[i] = tempMessages[i] + '\r\nContent-Length: 0';
                }
            }
            for (const message of tempMessages) {
                this.emit('message', sip_message_1.InboundMessage.fromString(message));
            }
        });
    }
    register() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.connected) {
                yield (0, wait_for_async_1.default)({ interval: 100, condition: () => this.connected });
            }
            const sipRegister = () => __awaiter(this, void 0, void 0, function* () {
                const requestMessage = new sip_message_1.RequestMessage(`REGISTER sip:${this.sipInfo.domain} SIP/2.0`, {
                    'Call-Id': (0, utils_1.uuid)(),
                    Contact: `<sip:${this.fakeEmail};transport=tcp>;expires=600`,
                    From: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${(0, utils_1.uuid)()}`,
                    To: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>`,
                    Via: `SIP/2.0/TCP ${this.fakeDomain};branch=${(0, utils_1.branch)()}`,
                });
                const inboundMessage = yield this.send(requestMessage, true);
                if (inboundMessage.subject.startsWith('SIP/2.0 200 ')) {
                    // sometimes the server will return 200 OK directly
                    return;
                }
                const wwwAuth = inboundMessage.headers['Www-Authenticate'] || inboundMessage.headers['WWW-Authenticate'];
                const nonce = wwwAuth.match(/, nonce="(.+?)"/)[1];
                const newMessage = requestMessage.fork();
                newMessage.headers.Authorization = (0, utils_1.generateAuthorization)(this.sipInfo, nonce, 'REGISTER');
                this.send(newMessage);
            });
            sipRegister();
            this.intervalHandle = setInterval(() => {
                sipRegister();
            }, 3 * 60 * 1000);
            this.on('message', (inboundMessage) => {
                if (!inboundMessage.subject.startsWith('INVITE sip:')) {
                    return;
                }
                this.emit('invite', inboundMessage);
            });
        });
    }
    enableDebugMode() {
        return __awaiter(this, void 0, void 0, function* () {
            this.on('message', (message) => console.log(`Receiving...(${new Date()})\n` + message.toString()));
            const tcpWrite = this.client.write.bind(this.client);
            this.client.write = (message) => {
                console.log(`Sending...(${new Date()})\n` + message);
                return tcpWrite(message);
            };
        });
    }
    revoke() {
        return __awaiter(this, void 0, void 0, function* () {
            clearInterval(this.intervalHandle);
            this.removeAllListeners();
            this.client.removeAllListeners();
            this.client.destroy();
        });
    }
    send(message, waitForReply = false) {
        this.client.write(message.toString());
        if (!waitForReply) {
            return new Promise((resolve) => {
                resolve(undefined);
            });
        }
        return new Promise((resolve) => {
            const messageListerner = (inboundMessage) => {
                if (inboundMessage.headers.CSeq !== message.headers.CSeq) {
                    return;
                }
                if (inboundMessage.subject.startsWith('SIP/2.0 100 ')) {
                    return; // ignore
                }
                this.off('message', messageListerner);
                resolve(inboundMessage);
            };
            this.on('message', messageListerner);
        });
    }
    answer(inviteMessage) {
        return __awaiter(this, void 0, void 0, function* () {
            const inboundCallSession = new inbound_1.default(this, inviteMessage);
            yield inboundCallSession.answer();
            return inboundCallSession;
        });
    }
    // decline an inbound call
    decline(inviteMessage) {
        return __awaiter(this, void 0, void 0, function* () {
            const newMessage = new sip_message_1.ResponseMessage(inviteMessage, 603);
            this.send(newMessage);
        });
    }
    call(callee, callerId) {
        return __awaiter(this, void 0, void 0, function* () {
            const offerSDP = `
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
            const inviteMessage = new sip_message_1.RequestMessage(`INVITE sip:${callee}@${this.sipInfo.domain} SIP/2.0`, {
                'Call-Id': (0, utils_1.uuid)(),
                Contact: `<sip:${this.fakeEmail};transport=tcp>;expires=600`,
                From: `<sip:${this.sipInfo.username}@${this.sipInfo.domain}>;tag=${(0, utils_1.uuid)()}`,
                To: `<sip:${callee}@${this.sipInfo.domain}>`,
                Via: `SIP/2.0/TCP ${this.fakeDomain};branch=${(0, utils_1.branch)()}`,
                'Content-Type': 'application/sdp',
            }, offerSDP);
            if (callerId) {
                inviteMessage.headers['P-Asserted-Identity'] = `sip:${callerId}@${this.sipInfo.domain}`;
            }
            const inboundMessage = yield this.send(inviteMessage, true);
            const proxyAuthenticate = inboundMessage.headers['Proxy-Authenticate'];
            const nonce = proxyAuthenticate.match(/, nonce="(.+?)"/)[1];
            const newMessage = inviteMessage.fork();
            newMessage.headers['Proxy-Authorization'] = (0, utils_1.generateAuthorization)(this.sipInfo, nonce, 'INVITE');
            const progressMessage = yield this.send(newMessage, true);
            return new outbound_1.default(this, progressMessage);
        });
    }
}
exports.default = Softphone;
//# sourceMappingURL=softphone.js.map