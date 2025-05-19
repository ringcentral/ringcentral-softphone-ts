# Stream or play audio into a phone call

```ts
import fs from "node:fs";
import process from "node:process";
import type { RtpPacket } from "werift-rtp";
import Softphone from "../src/index.js";

const softphone = new Softphone({
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY!,
  username: process.env.SIP_INFO_USERNAME!,
  password: process.env.SIP_INFO_PASSWORD!,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID!,
  domain: process.env.SIP_INFO_DOMAIN!,
});
softphone.enableDebugMode(); // print all SIP messages

const main = async () => {
  await softphone.register();
  // detect inbound call
  softphone.on("invite", async (inviteMessage) => {
    // answer the call
    const callSession = await softphone.answer(inviteMessage);

	// send audio to remote peer
    const streamer = callSession.streamAudio(fs.readFileSync('demos/test.wav'));
    // You may subscribe to the 'finished' event of the streamer to 
	// know when the audio sending is finished
    streamer.once('finished', () => {
      console.log('audio sending finished');
    });
    // you may pause/resume/stop audio sending at any time
    // streamer.pause();
    // streamer.resume();
    // streamer.stop();
    // streamer.start();
  });
};
main();
```
