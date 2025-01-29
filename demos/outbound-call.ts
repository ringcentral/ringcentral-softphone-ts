import fs from "fs";

import waitFor from "wait-for-async";
import type { RtpPacket } from "werift-rtp";

import Softphone from "../src/index";

const softphone = new Softphone({
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY!,
  username: process.env.SIP_INFO_USERNAME!,
  password: process.env.SIP_INFO_PASSWORD!,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID!,
  domain: process.env.SIP_INFO_DOMAIN!,
  codec: "PCMU/8000", // optional, default is "OPUS/16000", you may specify "PCMU/8000", "OPUS/48000/2"
});
softphone.enableDebugMode(); // print all SIP messages

const main = async () => {
  await softphone.register();
  await waitFor({ interval: 1000 });
  // callee format sample: 16506668888, country code is required, otherwise behavior is undefined
  const callSession = await softphone.call(process.env.CALLEE_FOR_TESTING!);

  callSession.on("busy", () => {
    console.log("cannot reach the callee");
  });

  // callee answers the call
  callSession.once("answered", async () => {
    // receive audio
    const writeStream = fs.createWriteStream(`${callSession.callId}.wav`, {
      flags: "a",
    });
    callSession.on("audioPacket", (rtpPacket: RtpPacket) => {
      writeStream.write(rtpPacket.payload);
    });
    // either you or the peer hang up
    callSession.once("disposed", () => {
      writeStream.close();
    });

    // call transfer
    // await waitFor({ interval: 3000 });
    // callSession.transfer(process.env.ANOTHER_CALLEE_FOR_TESTING!);

    // // send audio to remote peer
    // const streamer = callSession.streamAudio(
    //   fs.readFileSync("demos/pcmu-8000.wav"),
    // );
    // // You may subscribe to the 'finished' event of the streamer to know when the audio sending is finished
    // streamer.once("finished", () => {
    //   console.log("audio sending finished");
    // });
    // // you may pause/resume/stop audio sending at any time
    // await waitFor({ interval: 3000 });
    // streamer.pause();
    // await waitFor({ interval: 3000 });
    // streamer.resume();
    // await waitFor({ interval: 2000 });
    // streamer.stop();
    // // you may start/restart the streaming:
    // streamer.start();

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

  // // cancel the call (before the peer answers)
  // await waitFor({ interval: 8000 });
  // callSession.cancel();
};
main();
