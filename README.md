# RingCentral Softphone SDK for TypeScript

This is a TypeScript SDK for RingCentral Softphone. It is a complete rewrite of the [RingCentral Softphone SDK for JavaScript](https://github.com/ringcentral/ringcentral-softphone-js)

Users are recommended to use this SDK instead of the JavaScript SDK.


## Installation

```
yarn install ringcentral-softphone
```

## Usage

```typescript
import fs from 'fs';
import Softphone from 'ringcentral-softphone';
import type { RtpPacket } from 'werift-rtp';

const softphone = new Softphone({
  username: process.env.SIP_INFO_USERNAME,
  password: process.env.SIP_INFO_PASSWORD,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
});
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
    // receive DTMF
    callSession.on('dtmf', (digit) => {
      console.log('dtmf', digit);
    });
  });
};
main();
```

For a complete example, see [src/index.ts](src/index.ts)


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

- outbound call
- Try other payload types, such as OPUS
- support callerId
- do not hard code `domain` and `outboundProxy`
