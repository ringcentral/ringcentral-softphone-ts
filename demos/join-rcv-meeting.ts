import fs from "node:fs";
import process from "node:process";
import waitFor from "wait-for-async";
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
  const callSession = await softphone.call(
    process.env.MEETING_NUMBER_FOR_TESTING!,
  );

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

    // enter meeting access code
    await waitFor({ interval: 6000 });
    await callSession.sendDTMFs(
      `${process.env.MEETING_ACCESS_CODE_FOR_TESTING}#`,
    ); // meeting access code followed by #

    // enter participant ID
    await waitFor({ interval: 6000 });
    await callSession.sendDTMF("#"); // enter # directly

    // quit after 10 seconds
    await waitFor({ interval: 10000 });
    await callSession.hangup();
    await softphone.revoke();
  });
};
main();
