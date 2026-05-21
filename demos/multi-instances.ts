import process from "node:process";

import Softphone from "../src/index.js";

const newSoftphoneInstance = async (name: string) => {
  const softphone = new Softphone({
    outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY!,
    username: process.env.SIP_INFO_USERNAME!,
    password: process.env.SIP_INFO_PASSWORD!,
    authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID!,
    domain: process.env.SIP_INFO_DOMAIN!,
  });
  softphone.enableDebugMode({
    inboundPrefix: `${name} - Receiving...\n`,
    outboundPrefix: `${name} - Sending...\n`,
  }); // print all SIP messages
  await softphone.register();
};

const main = async () => {
  for (let i = 1; i <= 10; i++) {
    await newSoftphoneInstance(`Softphone ${i}`);
  }
};
main();

/*
You can create multiple instances using same credentials.
However, only the latest instance will receive inbound calls.
*/
