# Record phone audio to a server 

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
    const callSession = await softphone.answer(inviteMessage);
    // receive audio
    const writeStream = fs.createWriteStream(`${callSession.callId}.wav`, {
      flags: "a",
    });
    callSession.on("audioPacket", (rtpPacket: RtpPacket) => {
      writeStream.write(rtpPacket.payload);
    });
    callSession.once("disposed", () => {
      writeStream.close();
    });
  });
};
main();
```
