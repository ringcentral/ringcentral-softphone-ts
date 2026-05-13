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
  await newSoftphoneInstance("Softphone 1");
  await newSoftphoneInstance("Softphone 2");
  await newSoftphoneInstance("Softphone 3");
  await newSoftphoneInstance("Softphone 4");
  await newSoftphoneInstance("Softphone 5");
  await newSoftphoneInstance("Softphone 6");
};
main();

/*
You can create multiple instances using same credentials.
However, only the latest instance will receive inbound calls.
*/
