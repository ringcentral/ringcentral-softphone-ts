import fs from 'fs';

import Softphone from './softphone';

const softphone = new Softphone({
  username: process.env.SIP_INFO_USERNAME,
  password: process.env.SIP_INFO_PASSWORD,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
});
softphone.enableDebugMode(); // print all SIP messages

const main = async () => {
  await softphone.register();
  softphone.on('invite', async (inviteMessage) => {
    await softphone.answer(inviteMessage);
  });
  const audioFile = 'test.raw'; // audio file will be PCMU encoded, encoding is mu-law
  if (fs.existsSync(audioFile)) {
    fs.unlinkSync(audioFile);
  }
  const writeStream = fs.createWriteStream(audioFile, { flags: 'a' });
  softphone.on('rtpPacket', (rtpPacket) => {
    console.log(rtpPacket);
    writeStream.write(rtpPacket.payload);
  });
};
main();
