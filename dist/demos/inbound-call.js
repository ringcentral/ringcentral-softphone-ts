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
const fs_1 = __importDefault(require("fs"));
const softphone_1 = __importDefault(require("../src/softphone"));
// import waitFor from 'wait-for-async';
const softphone = new softphone_1.default({
    username: process.env.SIP_INFO_USERNAME,
    password: process.env.SIP_INFO_PASSWORD,
    authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
    domain: process.env.SIP_INFO_DOMAIN,
});
softphone.enableDebugMode(); // print all SIP messages
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    yield softphone.register();
    // detect inbound call
    softphone.on('invite', (inviteMessage) => __awaiter(void 0, void 0, void 0, function* () {
        // decline the call
        // await waitFor({ interval: 1000 });
        // await softphone.decline(inviteMessage);
        // answer the call
        const callSession = yield softphone.answer(inviteMessage);
        // receive audio
        const writeStream = fs_1.default.createWriteStream(`${callSession.callId}.raw`, { flags: 'a' });
        callSession.on('audioPacket', (rtpPacket) => {
            writeStream.write(rtpPacket.payload);
        });
        // // // send audio to remote peer
        // const streamer = callSession.streamAudio(fs.readFileSync('demos/test.raw'));
        // await waitFor({ interval: 3000 });
        // // you may interrupt audio sending at any time
        // streamer.stop();
        // either you or the peer hang up
        callSession.once('disposed', () => {
            writeStream.close();
        });
        // receive DTMF
        callSession.on('dtmf', (digit) => {
            console.log('dtmf', digit);
        });
        // // send DTMF
        // await waitFor({ interval: 2000 });
        // callSession.sendDTMF('1');
        // await waitFor({ interval: 2000 });
        // callSession.sendDTMF('#');
        // // hang up the call
        // await waitFor({ interval: 5000 });
        // callSession.hangup();
        // // transfer the call
        // await waitFor({ interval: 2000 });
        // await callSession.transfer(process.env.ANOTHER_CALLEE_FOR_TESTING);
    }));
});
main();
//# sourceMappingURL=inbound-call.js.map