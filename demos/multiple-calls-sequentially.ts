import Softphone from "../src/index.js";

const softphone = new Softphone({
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY!,
  username: process.env.SIP_INFO_USERNAME!,
  password: process.env.SIP_INFO_PASSWORD!,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID!,
  domain: process.env.SIP_INFO_DOMAIN!,
});
softphone.enableDebugMode(); // print all SIP messages

const call = async () => {
  const callSession = await softphone.call(process.env.CALLEE_FOR_TESTING!);
  return new Promise<void>((resolve) => {
    callSession.once("disposed", () => {
      resolve();
    });
  });
};

const main = async () => {
  await softphone.register();
  for (let i = 0; i < 10; i++) {
    console.log(`Starting call ${i + 1}`);
    await call();
    console.log(`Call ${i + 1} ended`);
  }
  await softphone.revoke();
};

main();
