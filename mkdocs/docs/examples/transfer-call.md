# Transfer a phone call from a server

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
	// call transfer
    callSession.transfer(process.env.ANOTHER_CALLEE_FOR_TESTING!);
  });
};
main();
```
