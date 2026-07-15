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
  callSession.on("audioPacket", (packet) => {
    console.log("Received audio bytes:", packet.payload.length);
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

## Consumer API

The tables below intentionally document the supported integration surface. Raw
sockets, SRTP state, codec workers, peers, sequence counters, and internal
helpers are implementation details.

### Softphone methods

| Method | Result | Purpose |
| --- | --- | --- |
| `register()` | `Promise<void>` | Connect and register; refreshes the registration until revoked. |
| `revoke()` | `void` | Stop registration, remove listeners, and close the TLS connection. |
| `enableDebugMode(options?)` | `void` | Log inbound and outbound SIP messages, optionally with custom prefixes. |
| `answer(inviteMessage)` | `Promise<InboundCallSession>` | Answer an inbound invite and create its call session. |
| `decline(inviteMessage)` | `Promise<void>` | Decline an inbound invite with SIP status 603. |
| `call(callee)` | `Promise<OutboundCallSession>` | Start an outbound call. |

### Softphone events and observation properties

| Member | Payload/value | Purpose |
| --- | --- | --- |
| `invite` | `InboundMessage` | A new inbound call can be answered or declined. |
| `message` | `InboundMessage` | Observe every parsed inbound SIP message. |
| `outboundMessage` | `string` | Observe every serialized outbound SIP message. |
| `registrationError` | `Error` | A registration refresh failed. |
| `sipInfo` | `SoftPhoneOptions` | The active SIP configuration. Treat credentials as sensitive. |
| `codec.id` | `number` | RTP payload type for the selected audio codec; useful when forwarding RTP. |

### CallSession methods

| Method | Result | Purpose |
| --- | --- | --- |
| `hangup()` | `Promise<void>` | Hang up an active call. |
| `sendDTMF(char)` | `void` | Send one of `0-9`, `*`, `#`, or `A-D`. |
| `sendDTMFs(chars, delay?)` | `Promise<void>` | Send a sequence with a 500 ms default delay after each character. |
| `streamAudio(buffer)` | `Streamer` | Start sending a buffer in the selected codec's raw input format. |
| `sendPacket(rtpPacket)` | `void` | Forward a received RTP packet to this session. |
| `transfer(destination)` | `Promise<void>` | Transfer an active call. |
| `hold()` / `unhold()` | `Promise<void>` | Stop or resume receiving remote audio through SIP re-invite. |
| `cancel()` | `Promise<void>` | Cancel an unanswered outbound call. Outbound only. |

### CallSession properties and events

| Member | Payload/value | Purpose |
| --- | --- | --- |
| `callId` | `string` | SIP Call-ID for inbound and outbound calls. |
| `disposed` | `boolean` | Whether the session has been disposed. |
| `sessionId` | `string` | RingCentral telephony session ID. Outbound only. |
| `partyId` | `string` | RingCentral telephony party ID. Outbound only. |
| `answered` | no payload | The peer answered. Outbound only. |
| `busy` | no payload | The destination returned SIP 486 and the session was disposed. Outbound only. |
| `disposed` | no payload | The session closed. |
| `audioPacket` | `RtpPacket` | Decoded audio in `packet.payload`. |
| `dtmf` | `string` | A decoded DTMF character. |
| `dtmfPacket` | `RtpPacket` | An incoming telephone-event RTP packet. |
| `rtpPacket` | `RtpPacket` | Any decrypted incoming RTP packet, before audio decoding. |

### Streamer controls, state, and events

| Member | Result/value | Purpose |
| --- | --- | --- |
| `start()` | `void` | Start from the beginning, or restart after completion. |
| `stop()` | `void` | Stop and discard the remaining buffered audio. |
| `pause()` | `void` | Pause sending. |
| `resume()` | `void` | Resume sending. |
| `paused` | `boolean` | Whether sending is paused. |
| `finished` | `boolean` | Whether the buffer is exhausted or the call is disposed. |
| `finished` event | no payload | The audio buffer has been sent. |

## Audio

`audioPacket` exposes audio in the selected codec's decoded format.
`streamAudio()` expects a `Buffer` in the matching input format:

| Codec | Format | Playback example |
| --- | --- | --- |
| `OPUS/16000` (default) | 16-bit signed little-endian PCM, 16 kHz, mono | `ffplay -autoexit -f s16le -ar 16000 -ac 1 audio.raw` |
| `OPUS/48000/2` | 16-bit signed little-endian PCM, 48 kHz, stereo | `ffplay -autoexit -f s16le -ar 48000 -ac 2 audio.raw` |
| `PCMU/8000` | 8-bit mu-law, 8 kHz, mono | `ffplay -autoexit -f mulaw -ar 8000 -ac 1 audio.raw` |

For example:

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

## Advanced usage

### Debug and SIP observation

```ts
softphone.enableDebugMode();

softphone.on("message", (message) => {
  console.log("Inbound SIP subject:", message.subject);
});

softphone.on("outboundMessage", (message) => {
  console.log("Outbound SIP message:", message);
});
```

Custom debug prefixes can distinguish multiple instances:

```ts
softphone.enableDebugMode({
  inboundPrefix: "Instance A receiving...\n",
  outboundPrefix: "Instance A sending...\n",
});
```

### Forward RTP between call sessions

```ts
callSession1.on("rtpPacket", (packet) => {
  if (packet.header.payloadType === softphone.codec.id) {
    callSession2.sendPacket(packet);
  }
});
```

`sendPacket()` encrypts the packet for the destination call session. Do not
access the underlying sockets or SRTP session directly.

### Multiple instances with the same credentials

Multiple instances can register with the same credentials, but only the most
recent instance receives inbound calls.

### Telephony session and party IDs

Outbound call sessions expose `sessionId` and `partyId`, parsed from the
`p-rc-api-ids` SIP header. RingCentral does not include these values in the
initial inbound invite. For inbound calls, see the
[call-ID workaround](https://github.com/tylerlong/rc-softphone-call-id-test).

### TLS certificate errors

Most applications should leave certificate verification enabled. For a trusted,
controlled lab with a self-signed or misconfigured certificate, set
`ignoreTlsCertErrors: true`. This makes the connection vulnerable to
man-in-the-middle attacks and must not be used in production.

### Conferences

Conference creation and management use the RingCentral REST API and are outside
this SDK's scope, but the SDK can place calls into conferences. See the
[conference demo project](https://github.com/tylerlong/softphone-invite-agent-to-conference-demo).

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
yarn test
```

## Development

Format and lint the project:

```bash
yarn lint
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

The SDK intentionally relies on the initial RTP packet to establish the local
media endpoint, so the SDP port does not need to expose a separately configured
local UDP port. SIP behavior is based on [RFC 3261](https://www.rfc-editor.org/rfc/rfc3261).

Caller-ID selection through `P-Asserted-Identity` is not supported.
