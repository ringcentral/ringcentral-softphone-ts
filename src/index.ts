import fs from 'fs';

import Softphone from './softphone';
import type { RtpPacket } from 'werift-rtp';
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
    // decline the call
    // await waitFor({ interval: 1000 });
    // await softphone.decline(inviteMessage);
    const callSession = await softphone.answer(inviteMessage);

    // receive audio
    const writeStream = fs.createWriteStream(`${callSession.callId}.raw`, { flags: 'a' });
    callSession.on('audioPacket', (rtpPacket: RtpPacket) => {
      writeStream.write(rtpPacket.payload);
    });

    // receive DTMF
    callSession.on('dtmf', (digit) => {
      console.log('dtmf', digit);
    });

    // hang up the call
    // setTimeout(() => {
    //   callSession.hangup();
    // }, 5000);

    // send DTMF
    setTimeout(() => {
      callSession.sendDTMF('0');
    }, 2000);
    setTimeout(() => {
      callSession.sendDTMF('#');
    }, 4000);
  });
};
main();
