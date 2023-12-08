# RingCentral Softphone SDK for TypeScript

This is a TypeScript SDK for RingCentral Softphone. It is a complete rewrite of the [RingCentral Softphone SDK for JavaScript](https://github.com/ringcentral/ringcentral-softphone-js)

Users are recommended to use this SDK instead of the JavaScript SDK.


## Installation

```
yarn install ringcentral-softphone
```

## Where to get SIP_INFO_USERNAME, SIP_INFO_PASSWORD and SIP_INFO_AUTHORIZATION_ID?

1. Login to https://service.ringcentral.com
2. Find the user/extension you want to use
3. Check the user's "Devices & Numbers"
4. Find a phone/device that you want to use
  1. if there is none, you need to create one. Check steps below for more details
5. Click the "Set Up and Provision" button
6. Click the link "Set up manually using SIP"
7. At the bottom part of the page, you will find "User Name", "Password" and "Authorization ID"


## Usage

```ts
import fs from 'fs';
import Softphone from 'ringcentral-softphone';
import type { RtpPacket } from 'werift-rtp';

const softphone = new Softphone({
  username: process.env.SIP_INFO_USERNAME,
  password: process.env.SIP_INFO_PASSWORD,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
});
softphone.enableDebugMode(); // optional, print all SIP messages
const main = async () => {
  await softphone.register();
  // inbound call
  softphone.on('invite', async (inviteMessage) => {
    // answer the call
    const callSession = await softphone.answer(inviteMessage);
    // receive audio
    const writeStream = fs.createWriteStream(`${callSession.callId}.raw`, { flags: 'a' });
    callSession.on('audioPacket', (rtpPacket: RtpPacket) => {
      writeStream.write(rtpPacket.payload);
    });
     // either you or the peer hang up
    callSession.on('disposed', () => {
      writeStream.close();
    });
    // receive DTMF
    callSession.on('dtmf', (digit) => {
      console.log('dtmf', digit);
    });
  });
};
main();
```

For a complete example, see [src/index.ts](src/index.ts)


## Supported features

- inbound call
- outbound call
- inbound DTMF 
- outbound DTMF
- reject inbound call
- cancel outbound call
- hang up ongoing call
- receive remote audio stream


## How to test

Make a phone call to you device's number.

There will be audio stream coming in. And you can also get the DTMF digits the caller pressed.


## Notes

### How to play saved audio file

```
ffplay -autoexit -f mulaw -ar 8000 test.raw
```

Or

```
play -b 8 -r 8000 -e mu-law test.raw
```


## Todo

- Try other payload types, such as OPUS
  - tried OPUS/16000, but the received packets are quite small and cannot be played
- support callerId
- do not hard code `domain` and `outboundProxy`
  - I tried `sip10.ringcentral.com:5096` as `outboundProxy`, it requires TLS instead of TCP
  - I made TLS work, however for inbound call there is not INVITE message coming in, for outbound call "488 Not Acceptable Here"
- send audio to remote peer
- check the code of PJSIP and refactor the code.
- Let user check the call info, such as who is calling, who is being called, etc.


## Dev Notes

- We don't need to explicitly tell remote server our local RTP port via SIP SDP message. We will have to send a RTP message to the remote server first, so the remote server knows our IP and port. So the port number in SDP message could be fake.
