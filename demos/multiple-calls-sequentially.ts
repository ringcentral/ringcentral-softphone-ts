import { once } from "node:events";

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
for (let i = 0; i < 10; i++) {
  console.log(`Starting call ${i + 1}`);
  const callSession = await softphone.call(process.env.CALLEE_FOR_TESTING!);
  await once(callSession, "disposed");
  console.log(`Call ${i + 1} ended`);
}
softphone.revoke();
