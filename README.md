# RingCentral Softphone SDK for TypeScript

This is a TypeScript SDK for RingCentral Softphone. It is a complete rewrite of the [RingCentral Softphone SDK for JavaScript](https://github.com/ringcentral/ringcentral-softphone-js)

Users are recommended to use this SDK instead of the JavaScript SDK.

## Installation

```
yarn install ringcentral-softphone
```

## Where to get credentials?

### Manually

1. Login to https://service.ringcentral.com
2. Find the user/extension you want to use
3. Check the user's "Devices & Numbers"
4. Find a phone/device that you want to use
5. if there is none, you need to create one. Check steps below for more details
6. Click the "Set Up and Provision" button
7. Click the link "Set up manually using SIP"
8. You will find "SIP Domain", "Outbound Proxy", "User Name", "Password" and "Authorization ID"

Please note that, "SIP Domain" name should come without port number. I don't know why it shows a port number on the page.
This SDK requires a "domain" which is "SIP Domain" but without the port number.

### Programmatically

Invoke this RESTful API: https://developers.ringcentral.com/api-reference/Devices/readDeviceSipInfo

Please note that, in order to invoke this API, you need to be familiar with RingCentral RESTful programmming.

Here is a demo: https://github.com/tylerlong/rc-get-device-info-demo/blob/main/src/demo.ts

The credentials data returned by that API is like this:

```json
{
  "domain": "sip.ringcentral.com",
  "outboundProxies": [
    {
      "region": "EMEA",
      "proxy": "sip40.ringcentral.com:5090",
      "proxyTLS": "sip40.ringcentral.com:5096"
    },
    {
      "region": "APAC",
      "proxy": "sip71.ringcentral.com:5090",
      "proxyTLS": "sip71.ringcentral.com:5096"
    },
    {
      "region": "APAC",
      "proxy": "sip60.ringcentral.com:5090",
      "proxyTLS": "sip60.ringcentral.com:5096"
    },
    {
      "region": "EMEA",
      "proxy": "sip30.ringcentral.com:5090",
      "proxyTLS": "sip30.ringcentral.com:5096"
    },
    {
      "region": "APAC",
      "proxy": "sip70.ringcentral.com:5090",
      "proxyTLS": "sip70.ringcentral.com:5096"
    },
    {
      "region": "APAC",
      "proxy": "sip50.ringcentral.com:5090",
      "proxyTLS": "sip50.ringcentral.com:5096"
    },
    {
      "region": "NA",
      "proxy": "SIP10.ringcentral.com:5090",
      "proxyTLS": "sip10.ringcentral.com:5096"
    },
    {
      "region": "NA",
      "proxy": "SIP20.ringcentral.com:5090",
      "proxyTLS": "sip20.ringcentral.com:5096"
    },
    {
      "region": "LATAM",
      "proxy": "sip80.ringcentral.com:5090",
      "proxyTLS": "sip80.ringcentral.com:5096"
    }
  ],
  "userName": "16501234567",
  "password": "password",
  "authorizationId": "802512345678"
}
```

You will need to choose a outboundProxy value based on your location.
And please choose the `proxyTLS` value because this SDK uses TLS.
For example if you leave in north America, choose `sip10.ringcentral.com:5096`.

## Usage

```ts
import Softphone from 'ringcentral-softphone';

const softphone = new Softphone({
  domain: process.env.SIP_INFO_DOMAIN,
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY,
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
- call transfer

## Notes

### Audio formats

The codec used between server and client is "OPUS/16000".
This SDK will auto decode/encode the codec to/from "uncompressed PCM".

Bit rate is 16, which means 16 bits per sample.
Sample rate is 16000, which means 16000 samples per second.
Encoding is "signed-integer".

You may play saved audio by the following command:

```
play -t raw -b 16 -r 16000 -e signed-integer test.wav
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

## Todo

- Make codec configurable

---

## Dev Notes

Content below is for the maintainer of this SDK.

- We don't need to explicitly tell remote server our local UDP port (for audio streaming) via SIP SDP message. We send a RTP message to the remote server first, so the remote server knows our IP and port. So, the port number in SDP message could be fake.
- Ref: https://www.ietf.org/rfc/rfc3261.txt
- Caller Id feature is not supported. `P-Asserted-Identity` doesn't work. I think it is by design, since hardphone cannot support it.
