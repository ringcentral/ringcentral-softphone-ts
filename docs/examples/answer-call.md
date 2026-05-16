# Answer a phone call on a server

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
    // decline the call
    // await waitFor({ interval: 1000 });
    // await softphone.decline(inviteMessage);
    // answer the call
    const callSession = await softphone.answer(inviteMessage);

    // do something with the call session
  });
};
main();
```
