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
```

For complete examples, see [demos/](demos/)


## Supported features

- inbound call
- outbound call
- inbound DTMF 
- outbound DTMF
- reject inbound call
- cancel outbound call
- hang up ongoing call
- receive audio stream from peer
- stream local audio to remote peer
- outbound call caller ID


## Notes

### Audio formats

The codec is "PCMU/8000". Bit rate is 8, which means 8 bits per sample. Sample rate is 8000, which means 8000 samples per second.

You may play saved audio by the following commands:

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
- do not hard code `domain` and `outboundProxy`
  - I tried `sip10.ringcentral.com:5096` as `outboundProxy`, it requires TLS instead of TCP
  - I made TLS work, however for inbound call there is not INVITE message coming in, for outbound call "488 Not Acceptable Here"
- check the code of PJSIP and refactor the code.
- Let developer check the call info, such as who is calling, who is being called, etc.


## Dev Notes

- We don't need to explicitly tell remote server our local RTP port via SIP SDP message. We send a RTP message to the remote server first, so the remote server knows our IP and port. So, the port number in SDP message could be fake.
