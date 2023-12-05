import fs from 'fs';

import Softphone from './softphone';
// import waitFor from 'wait-for-async';

const softphone = new Softphone({
  username: process.env.SIP_INFO_USERNAME,
  password: process.env.SIP_INFO_PASSWORD,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
});
softphone.enableDebugMode(); // print all SIP messages

const main = async () => {
  await softphone.register();

  // inbound call
  softphone.on('invite', async (inviteMessage) => {
    // await waitFor({ interval: 1000 });
    // await softphone.decline(inviteMessage);
    const callSession = await softphone.answer(inviteMessage);
    const writeStream = fs.createWriteStream(`${callSession.callId}.raw`, { flags: 'a' });
    callSession.on('rtpPacket', (rtpPacket) => {
      console.log('rtpPacket received');
      writeStream.write(rtpPacket.payload);
    });
    setTimeout(() => {
      callSession.hangup();
    }, 10000);
  });
};
main();
