# RingCentral Softphone SDK for TypeScript

This is a TypeScript SDK for RingCentral Softphone. It is a complete rewrite of the [RingCentral Softphone SDK for JavaScript](https://github.com/ringcentral/ringcentral-softphone-js)

Users are recommended to use this SDK instead of the JavaScript SDK.

## Installation

```
yarn install ringcentral-softphone
```

## Where to get SIP_INFO_OUTBOUND_PROXY, SIP_INFO_USERNAME, SIP_INFO_PASSWORD and SIP_INFO_AUTHORIZATION_ID?

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
- check the code of PJSIP and refactor the code.

## Dev Notes

- We don't need to explicitly tell remote server our local RTP port via SIP SDP message. We send a RTP message to the remote server first, so the remote server knows our IP and port. So, the port number in SDP message could be fake.
- Ref: https://www.ietf.org/rfc/rfc3261.txt
- Caller Id feature is not supported. `P-Asserted-Identity` doesn't work. I think it is by design, since hardphone cannot support it.
