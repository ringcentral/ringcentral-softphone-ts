import fs from "fs";

import type { RtpPacket } from "werift-rtp";

import Softphone from "../src/index";

// import waitFor from 'wait-for-async';

const softphone = new Softphone({
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY,
  username: process.env.SIP_INFO_USERNAME,
  password: process.env.SIP_INFO_PASSWORD,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
  domain: process.env.SIP_INFO_DOMAIN,
});
softphone.enableDebugMode(); // print all SIP messages

const main = async () => {
  await softphone.register();
  // detect inbound call
  softphone.on("invite", async (inviteMessage) => {
    // decline the call
    // await waitFor({ interval: 1000 });
    // await softphone.decline(inviteMessage);

    // answer the call
    const callSession = await softphone.answer(inviteMessage);

    // receive audio
    const writeStream = fs.createWriteStream(`${callSession.callId}.wav`, {
      flags: "a",
    });
    callSession.on("audioPacket", (rtpPacket: RtpPacket) => {
      writeStream.write(rtpPacket.payload);
    });

    // call transfer
    // await waitFor({ interval: 3000 });
    // callSession.transfer(process.env.ANOTHER_CALLEE_FOR_TESTING!);

    // // send audio to remote peer
    // const streamer = callSession.streamAudio(fs.readFileSync('demos/test.wav'));
    // // You may subscribe to the 'finished' event of the streamer to know when the audio sending is finished
    // streamer.once('finished', () => {
    //   console.log('audio sending finished');
    // });
    // // you may pause/resume/stop audio sending at any time
    // await waitFor({ interval: 3000 });
    // streamer.pause();
    // await waitFor({ interval: 3000 });
    // streamer.resume();
    // await waitFor({ interval: 2000 });
    // streamer.stop();

    // either you or the peer hang up
    callSession.once("disposed", () => {
      writeStream.close();
    });

    // receive DTMF
    callSession.on("dtmf", (digit) => {
      console.log("dtmf", digit);
    });

    // // send DTMF
    // await waitFor({ interval: 2000 });
    // callSession.sendDTMF('1');
    // await waitFor({ interval: 2000 });
    // callSession.sendDTMF('#');

    // // hang up the call
    // await waitFor({ interval: 5000 });
    // callSession.hangup();
  });
};
main();
