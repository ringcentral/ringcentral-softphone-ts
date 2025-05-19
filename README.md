# RingCentral Softphone SDK for TypeScript

This is a TypeScript SDK for RingCentral Softphone. It is a complete rewrite of
the
[RingCentral Softphone SDK for JavaScript](https://github.com/ringcentral/ringcentral-softphone-js)

Users are recommended to use this SDK instead of the JavaScript SDK.

This SDK allows you to create a softphone without GUI that runs on server-side
without a web browser.

## Installation

```
yarn install ringcentral-softphone
```

## Where to get credentials?

### Manually

1. Login to https://service.ringcentral.com
2. Find the user/extension you want to use
3. Check the user's "Devices & Numbers"
4. Find a phone/device that you want to use (Phone type **must** be "Existing
   Phone"), if there is none, you need to create one.
5. Click the "Set Up and Provision" button
6. Click the link "Set up manually using SIP"
7. You will find "SIP Domain", "Outbound Proxy", "User Name", "Password" and
   "Authorization ID"

Please note that, "SIP Domain" name should come without port number. I don't
know why it shows a port number on the page. This SDK requires a "domain" which
is "SIP Domain" but without the port number.

Please also note that, not every device/phone can be used with the softphone
SDK. Some phones/devices with type "RingCentral Phone app" cannot be used with
the softphone SDK. You will need to have a device/phone with type **"Exsting
Phone"**.

### Programmatically

Invoke this API to list all devices under an extension:
https://developers.ringcentral.com/api-reference/Devices/listExtensionDevices

Please note that, not every device can be used for this softphone SDK. You will
need to find an device with **`type: 'OtherPhone'`**. Devices with
`type: 'SoftPhone'` can **NOT** be used for this softphone SDK.

I know this is confusing. `type: 'SoftPhone'` in API response is the same as
`type = "RingCentral Phone app"` in the GUI (mentioned in the Manually section
above). `type: 'OtherPhone'` in API response is the same as
`type = "Exiting Phone"` in the GUI.

If you cannot find an appropriate device, you will need to create a device
manually. Please refer to the previous section.

Invoke this RESTful API:
https://developers.ringcentral.com/api-reference/Devices/readDeviceSipInfo

Please note that, in order to invoke this API, you need to be familiar with
RingCentral RESTful programmming.

Here is a demo:
https://github.com/tylerlong/rc-get-device-info-demo/blob/main/src/demo.ts

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
      "region": "NA",
      "proxy": "SIP20.ringcentral.com:5090",
      "proxyTLS": "sip20.ringcentral.com:5096"
    },
    {
      "region": "LATAM",
      "proxy": "sip80.ringcentral.com:5090",
      "proxyTLS": "sip80.ringcentral.com:5096"
    }
    ...
  ],
  "userName": "16501234567",
  "password": "password",
  "authorizationId": "802512345678"
}
```

You will need to choose a outboundProxy value based on your location. And please
choose the `proxyTLS` value because this SDK uses TLS. For example if you live
in north America, choose `sip10.ringcentral.com:5096`.

## Usage

```ts
import Softphone from "ringcentral-softphone";

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

## Audio codec

### By default it is `OPUS/16000`

### Other codecs

There are two more codecs supported: `OPUS/48000/2` and `PCMU/8000`.

To use them, you will need to explicitly set them when creating the softphone
instance:

```ts
import Softphone from "ringcentral-softphone";

const softphone = new Softphone({
  // ...
  codec: "PCMU/8000", // or "OPUS/48000/2" or "OPUS/16000"
  // ...
});
```

### OPUS/16000

The codec used between server and client is "OPUS/16000". This SDK will auto
decode/encode the codec to/from "uncompressed PCM".

Bit rate is 16, which means 16 bits per sample. Sample rate is 16000, which
means 16000 samples per second. Encoding is "signed-integer".

You may play saved audio by the following command:

```
play -t raw -b 16 -r 16000 -e signed-integer test.wav
```

To stream an audio file to remote peer, you need to make sure that the audio
file is playable by the command above.

#### ffmpeg

If you prefer ffmpeg, here is the command to play the file:

```
ffplay -autoexit -f s16le -ar 16000 test.wav
```

#### how to generate audio file for testing

On macOS:

```
say "Hello world" -o test.wav --data-format=LEI16@16000
```

For Linux and Windows, please do some investigation yourself. Audio file
generation is out of scope of this SDK.

### PCMU/8000

If you choose this codec, make sure audio is playable using the following
commands:

```
play -b 8 -r 8000 -e mu-law test.raw
```

Please note that, if I name the file as *.wav, `play` will complain:

```
play FAIL formats: can't open input file `6fdbbf2f-74fe-437a-b5a7-80c0c546baf0.wav': WAVE: RIFF header not found
```

Either you rename it to *.raw or use `ffplay` instead

```
ffplay -autoexit -f mulaw -ar 8000 test.wav
```

### OPUS/48000/2

If you choose this codec, make sure audio is playable using the following
commands:

```
play -t raw -b 16 -r 48000 -e signed-integer -c 2 test.wav
```

I don't know how to use `ffplay` to play such an audio file. Please create a PR
if you know, thanks.

## Multiple instances with same credentials

You can run multiple softphone instances with the same credentials without
encountering any errors. However, only the most recent instance will receive
inbound calls.

In the future, we may consider supporting multiple active instances using the
same credentials. For now, we believe there is no demand for this functionality.

## Invalid callee number

If you call an invalid number. The sip server will return "SIP/2.0 486 Busy
Here".

This SDK will emit a "busy" event for the call session and dispose it.

You can detect such an event by:

```ts
callSession.once("busy", () => {
  console.log("cannot reach the callee number");
});
```

## Pipe a call session to another

When you get audio from a call session, you may forward it to another call
session:

```ts
callSession1.on("rtpPacket", (rtpPacket: RtpPacket) => {
  // if statement is to make sure that it is an audio packet
  if (rtpPacket.header.payloadType === softphone.codec.id) {
    callSession2.sendPacket(rtpPacket);
  }
});
```

## Telephony Session ID

For outbound calls, you will be able to find header like this
`p-rc-api-ids: party-id=p-a0d17e323f0fez1953f50f90dz296e3440000-1;session-id=s-a0d17e323f0fez1953f50f90dz296e3440000`
from `callSession.sipMessage.headers`.

However, for inbound calls, the server doesn't tell us anything about the
Telephony Session ID. Here is a workaround solution:
https://github.com/tylerlong/rc-softphone-call-id-test

## Troubleshooting (Common issues)

### `SIP/2.0 486 Busy Here` for outbound call

First of all, make sure that the target number is valid. If the target number is
invalid, you will get `SIP/2.0 486 Busy Here`.

Secondly, make sure that the device has a "Emergency Address" configured and
there is no complains about Emergency address by checking the details of the
device on https://service.ringcentral.com. It is an known issue that, if the
Emergency Address is not configured properly, outbound call will not work.

---

## Dev Notes

Content below is for the maintainer/contributor of this SDK.

- We don't need to explicitly tell remote server our local UDP port (for audio
  streaming) via SIP SDP message. We send a RTP message to the remote server
  first, so the remote server knows our IP and port. So, the port number in SDP
  message could be fake.
- Ref: https://www.ietf.org/rfc/rfc3261.txt
- Caller Id feature is not supported. `P-Asserted-Identity` doesn't work. I
  think it is by design, since hardphone cannot support it.

#### Code style

We use `deno fmt && deno lint --fix` to format and lint all code.

#### Docs

All docs related files are located in `mkdocs` folder.

You will need to setup Python environment and install everything in
`mkdocs/requirements.txt`.

Serve the docs locally: `mkdocs serve -f mkdocs/mkdocs.yml`.

Deploy the docs: `mkdocs gh-deploy -f mkdocs/mkdocs.yml`
