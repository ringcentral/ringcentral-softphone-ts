# RingCentral Softphone SDK for TypeScript

`ringcentral-softphone` lets your Node.js application place and receive
RingCentral calls, stream audio, send and receive DTMF, and control calls without
a browser or graphical interface.

This TypeScript rewrite of the
[JavaScript SDK](https://github.com/ringcentral/ringcentral-softphone-js)
is recommended for new integrations.

## Install

```bash
npm install ringcentral-softphone
# Or: pnpm add ringcentral-softphone
```

## Get SIP credentials

In the [RingCentral portal](https://service.ringcentral.com), open the user or
extension's **Devices & Numbers**, select an **Existing Phone** device, then
choose **Set Up and Provision → Set up manually using SIP**. A RingCentral
desktop or mobile app device cannot be used with this SDK.

Copy the five credential values into your application's environment:

```bash
SIP_INFO_DOMAIN=sip.ringcentral.com
SIP_INFO_OUTBOUND_PROXY=sip20.ringcentral.com:5096
SIP_INFO_USERNAME=your-sip-username
SIP_INFO_PASSWORD=your-sip-password
SIP_INFO_AUTHORIZATION_ID=your-authorization-id
```

Use the domain without a port and the regional TLS outbound proxy with its port.
See [Getting Started](https://ringcentral.github.io/ringcentral-softphone-ts/getting-started/)
for illustrated instructions, REST API credential lookup, and all configuration
options.

## Create a softphone

The examples below use this `softphone` instance. Set the environment variables
before running your program.

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

softphone.on("signalingError", (error) => {
  console.error("Signaling failure:", error);
});
```

CommonJS applications use `require("ringcentral-softphone").default`.
TypeScript types such as `CallSession` and `SoftphoneOptions` can be imported
from the same package; event parameters and return values are inferred.

## Receive calls

Attach listeners before registering. `answer()` returns the call session used
for audio and call controls. Keep the registration active to receive more calls.

```ts
softphone.on("invite", async (invite) => {
  try {
    const callSession = await softphone.answer(invite);
    callSession.on("audio", (audio) => {
      console.log("Received audio bytes:", audio.length);
    });
    callSession.on("dtmf", (digit) => console.log("DTMF:", digit));
    callSession.once("disposed", () => console.log("Call ended"));
  } catch (error) {
    console.error("Could not answer incoming call:", error);
  }
});

await softphone.register();
```

Use `await softphone.decline(invite)` to decline instead. If your application
shows a ringing UI, listen for `inviteCanceled` to dismiss it. An invitation
can be canceled before `answer()` completes, so handle its rejection.
See [incoming calls](https://ringcentral.github.io/ringcentral-softphone-ts/guides/call-control/).

## Place a call

Use a destination that includes the country code. Run this after creating the
softphone above; it is an alternative to the receive-calls example.

```ts
await softphone.register();
const callSession = await softphone.call("16505550100");

callSession.once("answered", () => console.log("Call answered"));
callSession.once("non2xxResponse", ({ statusCode, reasonPhrase }) => {
  console.log(`Call not established: ${statusCode} ${reasonPhrase}`);
});
callSession.once("disposed", () => console.log("Call ended"));
```

`answered` means RingCentral accepted your call leg; it does not guarantee the
callee has picked up. `non2xxResponse` reports an unsuccessful final SIP response
and is followed by `disposed`. Your application decides how to interpret the
status code.

## Control a call

Use these controls when your application needs them; they are separate actions:

| Action | Method |
| --- | --- |
| Hang up an active call | `await callSession.hangup()` |
| Cancel a pending outbound call | `await callSession.cancel()` |
| Hold / resume a call | `await callSession.hold()` / `await callSession.unhold()` |
| Transfer an active call | `await callSession.transfer("16505550101")` |
| Send one DTMF digit | `callSession.sendDTMF("1")` |
| Send a DTMF sequence | `await callSession.sendDTMFs("101#", 500)` |

`cancel()` is available only on outbound sessions. Transfer resolves when the
transfer succeeds, rejects on failure, and has no built-in timeout. For event
handling, transfer failure behavior, and call identifiers, see the
[call guide](https://ringcentral.github.io/ringcentral-softphone-ts/guides/call-control/).

Hang up active calls before calling `softphone.revoke()` when your application
no longer needs the registration.

## Stream audio

The `audio` event receives a `Buffer`; `streamAudio()` sends one. Both use the
format selected by the constructor's `codec` option:

| Codec | Buffer format |
| --- | --- |
| `OPUS/16000` (default) | 16-bit signed little-endian PCM, 16 kHz, mono |
| `OPUS/48000/2` | 16-bit signed little-endian PCM, 48 kHz, interleaved stereo |
| `PCMU/8000` | 8-bit mu-law, 8 kHz, mono |

```ts
import fs from "node:fs";

const streamer = callSession.streamAudio(fs.readFileSync("audio.raw"));
streamer.once("finished", () => console.log("Audio sent"));
```

Streaming starts automatically. Use `pause()`, `resume()`, `stop()`, and `start()`
to control playback. Pause the streamer during hold and resume after unholding.
The SDK does not resample or convert files. RingCentral calls do not guarantee
end-to-end stereo separation. See the
[audio guide](https://ringcentral.github.io/ringcentral-softphone-ts/guides/audio/)
for recording, playback commands, and DTMF examples.

## Important behavior and limitations

- After a successful registration, the SDK reconnects automatically if signaling
  is lost. Operations during recovery fail immediately and are not replayed;
  listen for `signalingError`. See [connection recovery](https://ringcentral.github.io/ringcentral-softphone-ts/troubleshooting/#connection-loss-and-recovery).
- Only the most recent registration receives inbound calls when several
  instances share credentials.
- Inbound invitations do not provide RingCentral telephony session or party IDs.
- Custom caller ID selection is not supported. Conference management uses the
  RingCentral REST API; this SDK can dial into conferences.
- `enableDebugMode()` logs sensitive call, authentication, and media key data.
  Do not enable it in production or share unredacted output. Keep TLS certificate
  verification enabled in production.

## Guides and examples

The [documentation site](https://ringcentral.github.io/ringcentral-softphone-ts/)
contains the complete public API usage and behavior guides. This README is the
quick start.

- [Getting Started and configuration](https://ringcentral.github.io/ringcentral-softphone-ts/getting-started/)
- [Calls and events](https://ringcentral.github.io/ringcentral-softphone-ts/guides/call-control/)
- [Audio and DTMF](https://ringcentral.github.io/ringcentral-softphone-ts/guides/audio/)
- [Troubleshooting](https://ringcentral.github.io/ringcentral-softphone-ts/troubleshooting/)
- [Runnable demos](demos/)

For repository development, see [Contributing](CONTRIBUTING.md).
