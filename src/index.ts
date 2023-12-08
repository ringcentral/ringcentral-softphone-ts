import fs from 'fs';
import type { RtpPacket } from 'werift-rtp';

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
    // decline the call
    // await waitFor({ interval: 1000 });
    // await softphone.decline(inviteMessage);

    // answer the call
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

    callSession.on('disposed', () => {
      // either you or the peer hang up
      writeStream.close();
    });

    // // hang up the call
    // setTimeout(() => {
    //   callSession.hangup();
    // }, 5000);

    // send DTMF
    setTimeout(() => {
      callSession.sendDTMF('1');
    }, 2000);
    setTimeout(() => {
      callSession.sendDTMF('#');
    }, 4000);
  });

  // outbound call
  setTimeout(async () => {
    // callee format sample: 16506668888
    const callSession = await softphone.call(parseInt(process.env.CALLEE_FOR_TESTING!, 10));
    const writeStream = fs.createWriteStream(`${callSession.callId}.raw`, { flags: 'a' });
    callSession.on('audioPacket', (rtpPacket: RtpPacket) => {
      writeStream.write(rtpPacket.payload);
    });
    callSession.on('dtmf', (digit) => {
      console.log('dtmf', digit);
    });

    // hang up the call
    // setTimeout(() => {
    //   callSession.hangup();
    // }, 5000);

    // send DTMF
    // setTimeout(() => {
    //   callSession.sendDTMF('1');
    // }, 2000);
    // setTimeout(() => {
    //   callSession.sendDTMF('#');
    // }, 4000);

    // cancel the call (before the peer answers)
    // setTimeout(() => {
    //   callSession.cancel();
    // }, 8000);
  }, 1000);
};
main();
