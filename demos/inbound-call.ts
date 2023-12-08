import fs from 'fs';
import type { RtpPacket } from 'werift-rtp';

import Softphone from '../src/softphone';
// import waitFor from 'wait-for-async';

const softphone = new Softphone({
  username: process.env.SIP_INFO_USERNAME,
  password: process.env.SIP_INFO_PASSWORD,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
});
softphone.enableDebugMode(); // print all SIP messages

const main = async () => {
  await softphone.register();
  // detect inbound call
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

    // // send audio to remote peer
    // callSession.streamAudio(fs.readFileSync('demos/test.raw'));

    // either you or the peer hang up
    callSession.once('disposed', () => {
      writeStream.close();
    });

    // receive DTMF
    callSession.on('dtmf', (digit) => {
      console.log('dtmf', digit);
    });

    // // send DTMF
    // await waitFor({ interval: 2000 });
    // callSession.sendDTMF('1');
    // await waitFor({ interval: 2000 });
    // callSession.sendDTMF('#');

    // // hang up the call
    // await waitFor({ interval: 5000 });
    // callSession.hangup();
  });
};
main();
