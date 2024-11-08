# RingCentral Softphone SDK for TypeScript

This is a TypeScript SDK for RingCentral Softphone. It is a complete rewrite of the [RingCentral Softphone SDK for JavaScript](https://github.com/ringcentral/ringcentral-softphone-js)

Users are recommended to use this SDK instead of the JavaScript SDK.

## Installation

```
yarn install ringcentral-softphone
```

## Where to get credentials?

1. Login to https://service.ringcentral.com
2. Find the user/extension you want to use
3. Check the user's "Devices & Numbers"
4. Find a phone/device that you want to use
5. if there is none, you need to create one. Check steps below for more details
6. Click the "Set Up and Provision" button
7. Click the link "Set up manually using SIP"
8. At the bottom part of the page, you will find "Outbound Proxy", "User Name", "Password" and "Authorization ID"

## Usage

```ts
import Softphone from 'ringcentral-softphone';

const softphone = new Softphone({
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY,
  username: process.env.SIP_INFO_USERNAME,
  password: process.env.SIP_INFO_PASSWORD,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
});
```

For complete examples, see [demos/](demos/)

### domain

For UK accounts you need to explicitly specify the `domain` parameter:

```ts
{
  domain: 'sip.ringcentral.co.uk',
}
```

US accounts use `sip.ringcentral.com` by default if you don't specify it.

Please do not specify port number in domain.

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
- call transfer

## Notes

### Audio formats

The codec used between server and client is "OPUS/48000/2".
This SDK will auto decode/encode the codec to/from "uncompressed PCM".

Bit rate is 16, which means 16 bits per sample.
Sample rate is 48000, which means 48000 samples per second.
Encoding is "signed-integer".
There are two channels

You may play saved audio by the following command:

```
play -t raw -b 16 -r 48000 -e signed-integer -c 2 test.wav
```

### Invalid callee number

If you call an invalid number. The sip server will return "SIP/2.0 486 Busy Here".

This SDK will emit a "busy" event for the call session and dispose it.

You can detect such an event by:

```ts
callSession.once('busy', () => {
  console.log('cannot reach the callee number');
});
```

---

## Dev Notes

Content below is for the maintainer of this SDK.

- We don't need to explicitly tell remote server our local UDP port (for audio streaming) via SIP SDP message. We send a RTP message to the remote server first, so the remote server knows our IP and port. So, the port number in SDP message could be fake.
- Ref: https://www.ietf.org/rfc/rfc3261.txt
- Caller Id feature is not supported. `P-Asserted-Identity` doesn't work. I think it is by design, since hardphone cannot support it.
