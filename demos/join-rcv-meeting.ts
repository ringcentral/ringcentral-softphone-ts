import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import Softphone from "../src/index.js";

const softphone = new Softphone({
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY!,
  username: process.env.SIP_INFO_USERNAME!,
  password: process.env.SIP_INFO_PASSWORD!,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID!,
  domain: process.env.SIP_INFO_DOMAIN!,
});
softphone.enableDebugMode(); // print all SIP messages

await softphone.register();
const callSession = await softphone.call(
  process.env.MEETING_NUMBER_FOR_TESTING!,
);

// callee answers the call
callSession.once("answered", async () => {
  // receive audio
  const writeStream = fs.createWriteStream("audio.raw");
  callSession.on("audio", (audio) => {
    writeStream.write(audio);
  });
  // either you or the peer hang up
  callSession.once("disposed", () => {
    writeStream.close();
  });

  // enter meeting access code
  await sleep(6000);
  await callSession.sendDTMFs(
    `${process.env.MEETING_ACCESS_CODE_FOR_TESTING}#`,
  ); // meeting access code followed by #

  // enter participant ID
  await sleep(6000);
  callSession.sendDTMF("#"); // enter # directly

  // quit after 10 seconds
  await sleep(10000);
  await callSession.hangup();
  softphone.revoke();
});
