import fs from "node:fs";
import process from "node:process";
// import { setTimeout as sleep } from "node:timers/promises";

import Softphone from "../src/index.js";

const softphone = new Softphone({
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY!,
  username: process.env.SIP_INFO_USERNAME!,
  password: process.env.SIP_INFO_PASSWORD!,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID!,
  domain: process.env.SIP_INFO_DOMAIN!,
  // codec: "OPUS/16000", // optional, default is "OPUS/16000", you may also specify "PCMU/8000", "OPUS/48000/2"
});
softphone.enableDebugMode(); // print all SIP messages

// detect inbound call
softphone.on("invite", async (inviteMessage) => {
  // decline the call
  // await sleep(1000);
  // await softphone.decline(inviteMessage);

  // answer the call
  const callSession = await softphone.answer(inviteMessage);

  // receive audio
  const writeStream = fs.createWriteStream("audio.raw");
  callSession.on("audio", (audio) => {
    writeStream.write(audio);
  });
  // either you or the peer hang up
  callSession.once("disposed", () => {
    writeStream.close();
  });

  // call transfer
  // await sleep(3000);
  // await callSession.transfer(process.env.ANOTHER_CALLEE_FOR_TESTING!);

  // // send audio to remote peer
  // const streamer = callSession.streamAudio(fs.readFileSync('demos/test.wav'));
  // // You may subscribe to the 'finished' event of the streamer to know when the audio sending is finished
  // streamer.once('finished', () => {
  //   console.log('audio sending finished');
  // });
  // // you may pause/resume/stop audio sending at any time
  // await sleep(3000);
  // streamer.pause();
  // await sleep(3000);
  // streamer.resume();
  // await sleep(2000);
  // streamer.stop();
  // // you may start/restart the streaming:
  // streamer.start();

  // receive DTMF
  callSession.on("dtmf", (digit) => {
    console.log("dtmf", digit);
  });

  // // send DTMF
  // await sleep(2000);
  // callSession.sendDTMF('1');
  // await sleep(2000);
  // callSession.sendDTMF('#');

  // // hang up the call
  // await sleep(5000);
  // callSession.hangup();
});
await softphone.register();
