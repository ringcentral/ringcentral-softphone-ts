# RingCentral Softphone SDK for TypeScript

`ringcentral-softphone` creates a headless RingCentral softphone in Node.js. It
supports inbound and outbound calls, DTMF, audio streaming, transfer, hold, and
unhold without a browser or graphical interface.

This project is a TypeScript rewrite of the
[RingCentral Softphone SDK for JavaScript](https://github.com/ringcentral/ringcentral-softphone-js),
and is recommended for new integrations.

The README is the source of truth. The same information is organized as a
task-focused guide in the maintained
[hosted documentation](https://ringcentral.github.io/ringcentral-softphone-ts/).

## Installation

```bash
yarn add ringcentral-softphone
```

Or with npm:

```bash
npm install ringcentral-softphone
```

## Get SIP credentials

You need the SIP domain, TLS outbound proxy, username, password, and
authorization ID for an **Existing Phone** device.

### From the RingCentral web portal

1. Sign in to [RingCentral](https://service.ringcentral.com).
2. Open the user or extension that will place and receive calls.
3. Open **Devices & Numbers**.
4. Select an **Existing Phone** device, or create one if necessary.
5. Select **Set Up and Provision**.
6. Select **Set up manually using SIP**.
7. Copy the SIP domain, outbound proxy, username, password, and authorization ID.

Remove the port from the SIP domain. For example, use
`sip.ringcentral.com`, not `sip.ringcentral.com:5061`. Keep the port in the
outbound proxy.

Not every device can be used by this SDK. In particular, a device shown as the
RingCentral desktop or mobile app is not an **Existing Phone** device.

### From the RingCentral REST API

Use
[List Extension Devices](https://developers.ringcentral.com/api-reference/Devices/listExtensionDevices)
to find a device whose API `type` is `OtherPhone`. The API type `SoftPhone`
represents a RingCentral app device and cannot be used with this SDK.

Then call
[Read Device SIP Information](https://developers.ringcentral.com/api-reference/Devices/readDeviceSipInfo).
Choose the `proxyTLS` value for the region nearest your workload because the SDK
connects over TLS. The response has this shape:

```json
{
  "domain": "sip.ringcentral.com",
  "outboundProxies": [
    {
      "region": "NA",
      "proxy": "sip20.ringcentral.com:5090",
      "proxyTLS": "sip20.ringcentral.com:5096"
    }
  ],
  "userName": "16501234567",
  "password": "password",
  "authorizationId": "802512345678"
}
```

See the maintained
[credential lookup demo](https://github.com/tylerlong/rc-get-device-info-demo/blob/main/src/demo.ts)
for a complete REST API example.

## Configure a Softphone

```ts
import Softphone from "ringcentral-softphone";

const requiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const softphone = new Softphone({
  domain: requiredEnv("SIP_INFO_DOMAIN"),
  outboundProxy: requiredEnv("SIP_INFO_OUTBOUND_PROXY"),
  username: requiredEnv("SIP_INFO_USERNAME"),
  password: requiredEnv("SIP_INFO_PASSWORD"),
  authorizationId: requiredEnv("SIP_INFO_AUTHORIZATION_ID"),
});
```

### Softphone options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `domain` | `string` | Yes | SIP domain without a port, such as `sip.ringcentral.com`. |
| `outboundProxy` | `string` | Yes | Regional TLS proxy including its port, such as `sip20.ringcentral.com:5096`. |
| `username` | `string` | Yes | SIP username. |
| `password` | `string` | Yes | SIP password. |
| `authorizationId` | `string` | Yes | SIP authorization ID. |
| `codec` | `"OPUS/16000" \| "OPUS/48000/2" \| "PCMU/8000"` | No | Audio codec; defaults to `OPUS/16000`. |
| `ignoreTlsCertErrors` | `boolean` | No | Disables TLS certificate verification; defaults to `false`. Use only in controlled development environments. |

Consumer types come from the same package entry point:

```ts
import type {
  CallSession,
  InboundInvite,
  OutboundCallSession,
  SoftphoneOptions,
  Streamer,
} from "ringcentral-softphone";
```

Inline event handlers and returned values are inferred automatically. Import
these types when storing them or passing them between functions.

CommonJS consumers access the constructor through the package namespace:

```js
const Softphone = require("ringcentral-softphone").default;
```

## Receive a call

Attach the `invite` listener before registering so an inbound call cannot arrive
between registration and listener setup. `answer()` resolves to the resulting
call session.

```ts
import Softphone from "ringcentral-softphone";

const softphone = new Softphone({
  domain: process.env.SIP_INFO_DOMAIN!,
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY!,
  username: process.env.SIP_INFO_USERNAME!,
  password: process.env.SIP_INFO_PASSWORD!,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID!,
});

softphone.on("invite", async (inviteMessage) => {
  const callSession = await softphone.answer(inviteMessage);

  callSession.on("dtmf", (digit) => console.log("DTMF:", digit));
  callSession.on("audio", (audio) => {
    console.log("Received audio bytes:", audio.length);
  });
  callSession.once("disposed", () => {
    console.log("Call ended");
    softphone.revoke();
  });

  callSession.sendDTMF("1");
});

await softphone.register();
```

To reject an invite instead, call `await softphone.decline(inviteMessage)`.

## Place a call

Use a country-code-qualified destination. The returned outbound call session
emits `answered` or `busy`.

```ts
import Softphone from "ringcentral-softphone";

const softphone = new Softphone({
  domain: process.env.SIP_INFO_DOMAIN!,
  outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY!,
  username: process.env.SIP_INFO_USERNAME!,
  password: process.env.SIP_INFO_PASSWORD!,
  authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID!,
});

await softphone.register();
const callSession = await softphone.call("16505550100");

callSession.once("answered", async () => {
  console.log("Call answered");
  callSession.sendDTMF("1");
  await callSession.sendDTMFs("01#", 500);
  await callSession.hold();
  await callSession.unhold();
  await callSession.hangup();
  softphone.revoke();
});

callSession.once("busy", () => {
  console.log("The destination is busy or cannot be reached");
  softphone.revoke();
});

callSession.once("disposed", () => console.log("Call session disposed"));
```

Call `await callSession.cancel()` before the peer answers to cancel an outbound
call. Use `await callSession.transfer("16505550101")` to transfer an active call.

Complete programs are maintained under [`demos/`](demos/).

## Audio

The `audio` event provides a `Buffer` in the selected codec's decoded format.
`streamAudio()` expects a `Buffer` in the matching input format:

| Codec | Format | Playback example |
| --- | --- | --- |
| `OPUS/16000` (default) | 16-bit signed little-endian PCM, 16 kHz, mono | `ffplay -autoexit -f s16le -ar 16000 -ac 1 audio.raw` |
| `OPUS/48000/2` | 16-bit signed little-endian PCM, 48 kHz, stereo | `ffplay -autoexit -f s16le -ar 48000 -ac 2 audio.raw` |
| `PCMU/8000` | 8-bit mu-law, 8 kHz, mono | `ffplay -autoexit -f mulaw -ar 8000 -ac 1 audio.raw` |

Save received audio using the call ID as the filename:

```ts
import fs from "node:fs";

const output = fs.createWriteStream(`${callSession.callId}.raw`);
callSession.on("audio", (audio) => output.write(audio));
callSession.once("disposed", () => output.close());
```

Stream audio to the call:

```ts
import fs from "node:fs";

const streamer = callSession.streamAudio(fs.readFileSync("audio.raw"));
streamer.once("finished", () => console.log("Audio sent"));
streamer.pause();
streamer.resume();
streamer.stop();
streamer.start();
```

If a call is put on hold while streaming, pause the streamer and resume it after
unholding.

## DTMF

DTMF characters are limited to `0-9`, `*`, and `#`.

Send a single character immediately:

```ts
callSession.sendDTMF("1");
```

Send a sequence with a delay after each character:

```ts
await callSession.sendDTMFs("101#", 500);
```

Listen for decoded inbound DTMF:

```ts
callSession.on("dtmf", (digit) => console.log("DTMF:", digit));
```

## Additional scenarios

### Debugging

```ts
softphone.enableDebugMode();
```

The initial `register()` call rejects if registration fails. Listen for
`registrationError` to handle a later registration refresh failure:

```ts
softphone.on("registrationError", (error) => {
  console.error("Registration refresh failed", error);
});
```

Custom debug prefixes can distinguish multiple instances:

```ts
softphone.enableDebugMode({
  inboundPrefix: "Instance A receiving...\n",
  outboundPrefix: "Instance A sending...\n",
});
```

### Multiple instances with the same credentials

Multiple instances can register with the same credentials, but only the most
recent instance receives inbound calls.

### Telephony session and party IDs

Outbound call sessions expose optional `sessionId` and `partyId` values after
RingCentral supplies them. RingCentral does not include these values in the
initial inbound invite. For inbound calls, see the
[call-ID workaround](https://github.com/tylerlong/rc-softphone-call-id-test).

```ts
callSession.once("answered", () => {
  console.log(callSession.sessionId, callSession.partyId);
});
```

### TLS certificate errors

Most applications should leave certificate verification enabled. For a trusted,
controlled lab with a self-signed or misconfigured certificate, set
`ignoreTlsCertErrors: true`. This makes the connection vulnerable to
man-in-the-middle attacks and must not be used in production.

### Conferences

Conference creation and management use the RingCentral REST API and are outside
this SDK's scope, but the SDK can place calls into conferences. See the
[conference demo project](https://github.com/tylerlong/softphone-invite-agent-to-conference-demo).

## Limitations

- Only the most recent registration receives inbound calls when credentials
  are shared by several instances.
- Inbound invites do not provide RingCentral telephony session or party IDs.
- Audio files must already match the selected codec's raw input format.
- Conference orchestration belongs to the RingCentral REST API, not this SDK.
- Selecting a custom caller ID is not supported.

## Troubleshooting

### Outbound call emits `busy`

SIP status 486 means the destination is busy or cannot be reached. Confirm that:

- The destination includes its country code and is valid.
- The device has a valid **Emergency Address** in the RingCentral portal.

The SDK emits `busy` and disposes the outbound call session.

### Only one instance receives inbound calls

This is expected when several instances use the same credentials. The most
recent registration receives inbound calls.

### TLS certificate validation fails

Fix the certificate chain in production. Use `ignoreTlsCertErrors` only for a
trusted development environment.

### Registration fails

Check all five credential values. Use the domain without its port, a regional
`proxyTLS` value including its port, and credentials for an **Existing Phone**
device (`OtherPhone` in the REST API). Use `enableDebugMode()` to inspect the
registration exchange.

### Audio is distorted or silent

The input to `streamAudio()` must exactly match the sample format, rate, and
channel count for the selected codec. The SDK does not resample or convert
files.

## End-to-end test with real credentials

The integration test under `tests/e2e/` uses two SIP accounts. Put them in
`.env`:

```bash
SIP_A_DOMAIN=sip.ringcentral.com
SIP_A_OUTBOUND_PROXY=sip10.ringcentral.com:5096
SIP_A_USERNAME=1650...
SIP_A_PASSWORD=...
SIP_A_AUTHORIZATION_ID=...

SIP_B_DOMAIN=sip.ringcentral.com
SIP_B_OUTBOUND_PROXY=sip10.ringcentral.com:5096
SIP_B_USERNAME=1650...
SIP_B_PASSWORD=...
SIP_B_AUTHORIZATION_ID=...
```

Run it with:

```bash
yarn test:e2e
```

## Development

Format and lint the project:

```bash
yarn lint
```

Run the pull-request-safe validation suite:

```bash
yarn validate
```

Install and serve the documentation:

```bash
python -m pip install -r mkdocs/requirements.txt
mkdocs serve -f mkdocs/mkdocs.yml
```

Build documentation strictly:

```bash
mkdocs build --strict -f mkdocs/mkdocs.yml
```
