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
pnpm add ringcentral-softphone
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
  Non2xxResponse,
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
});

await softphone.register();
```

After a successful registration, the SDK automatically reconnects and
registers again if its TLS SIP signaling connection fails. The connection
loss and each failed recovery attempt are emitted as `signalingError`.
Signaling operations attempted during recovery fail immediately; interrupted
operations are not queued or replayed.

To reject an invite instead, call `await softphone.decline(inviteMessage)`.

An incoming invitation belongs to the Softphone that emitted it and is pending
until answered, declined, or canceled. `answer()` and `decline()` reject canceled,
already consumed, foreign, or otherwise no-longer-pending invitations. An answer
also rejects if the caller cancels while media is being allocated.

Listen for `inviteCanceled` to dismiss the ringing UI using the exact original,
opaque `InboundInvite` object. The SDK sends `200 OK` to CANCEL and `487 Request
Terminated` to the pending INVITE before this event, with fire-and-forget sends.
Cancellation does not dispose an already answered call; BYE ends that call.

```ts
import type { InboundInvite } from "ringcentral-softphone";

const ringing = new Set<InboundInvite>();
softphone.on("invite", (invite) => {
  ringing.add(invite); // Render the ringing UI for this invitation.
});
softphone.on("inviteCanceled", (invite) => {
  ringing.delete(invite); // Dismiss this invitation's ringing UI.
});
```

Remove the invitation from your ringing UI when you answer or decline it too,
and handle `answer()`/`decline()` rejections when a UI action races cancellation.
These listeners should be installed before registration.


The `invite` event is for new incoming calls. An INVITE whose exact Call-ID matches
an established inbound or outbound call is handled internally, even if its
To/From tags differ. It reuses the existing call session and media transport.
See [Established-call re-INVITEs](#established-call-re-invites) for supported updates.
The 603 Decline response applies only to the callee leg RingCentral presented
to you. RingCentral may already have answered the caller-facing leg before your
device was presented the call, so after your decline the caller can remain in
an answered call: it receives neither `non2xxResponse` nor a `disposed` event,
and RingCentral may continue routing the call, for example toward voicemail.
The caller's application decides when to hang up.

## Place a call

Use a country-code-qualified destination. The returned outbound call session
emits `answered` for a final 2xx INVITE response. A matching final 3xx–6xx
response emits `non2xxResponse` with the SIP status code and reason phrase and
then disposes the session. The SDK reports the response without classifying
it, so your application decides what 486, 487, 603, or any other status means
for it. The SDK sends the required ACK before `answered` or
`non2xxResponse`, so callbacks can immediately hang up or revoke signaling.
ACK sends are fire-and-forget. Later provisional (1xx) responses keep the call pending.

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

callSession.once("answered", () => console.log("Call answered"));

callSession.once("non2xxResponse", ({ statusCode, reasonPhrase }) => {
  console.log(`Call not established: ${statusCode} ${reasonPhrase}`);
});

callSession.once("disposed", () => {
  console.log("Call session disposed");
  softphone.revoke();
});
```

For RingCentral-to-RingCentral calls, RingCentral may answer your leg (emitting
`answered`) before the callee's device is presented the call. If the callee
declines, your session stays answered and emits neither `non2xxResponse` nor
`disposed`; hang up when your application is done with the call.

Call `await callSession.cancel()` before the peer answers to cancel an outbound
call. After the peer answers, use the call controls below as needed and call
`await callSession.hangup()` when the application is finished with the call.
Use `await callSession.transfer("16505550101")` to transfer an active call.
Its existing `Promise<void>` stays pending during transfer progress and after a
successful REFER response; it resolves on a successful final transfer NOTIFY and
rejects on an explicit REFER or transfer NOTIFY failure. A failed transfer alone
leaves the original call available unless ordinary call-ending signaling arrives.
The SDK sends matching NOTIFY replies before settling the Promise; those protocol
sends remain fire-and-forget, without delivery confirmation. Overlapping transfers
are rejected; another transfer can start after an explicit outcome.

When the remote peer hangs up, the SDK sends `200 OK` to its BYE request before
releasing the call's media and emitting `disposed`. A `disposed` callback may
revoke signaling without preventing that reply. These sends are fire-and-forget;
they do not wait for delivery confirmation. If sending the reply throws locally,
the SDK reports `signalingError` and still releases the ended call.

Complete programs are maintained under [`demos/`](demos/).

## Audio

Each call independently generates fresh local SRTP key material to encrypt and
authenticate its outgoing audio and DTMF. Keys are isolated across concurrent and
sequential calls, including calls on different Softphone instances. The same call
retains its key through hold/unhold, supported media destination updates, and SIP
signaling recovery. Exposure of one call's key does not expose other calls' keys,
but it can expose that call's captured outgoing media.

The `audio` event provides a `Buffer` in the selected codec's decoded format.
`streamAudio()` expects a `Buffer` in the matching input format:

| Codec | Format | Playback example |
| --- | --- | --- |
| `OPUS/16000` (default) | 16-bit signed little-endian PCM, 16 kHz, mono | `ffplay -autoexit -f s16le -ar 16000 -ac 1 audio.raw` |
| `OPUS/48000/2` | 16-bit signed little-endian PCM, 48 kHz, stereo | `ffplay -autoexit -f s16le -ar 48000 -ac 2 audio.raw` |
| `PCMU/8000` | 8-bit mu-law, 8 kHz, mono | `ffplay -autoexit -f mulaw -ar 8000 -ac 1 audio.raw` |

The SDK accepts and locally processes `OPUS/48000/2` as 16-bit signed
little-endian PCM, 48 kHz, interleaved stereo: every four-byte frame carries
one left sample followed by one right sample. RingCentral-hosted calls
currently downmix independent stereo content, so do not rely on end-to-end
left/right channel separation over a RingCentral call.

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
```

Streaming starts automatically on the next event-loop turn, so the `finished`
listener above is attached before even short input can complete. `pause()` keeps
the current position, `resume()` continues a paused run, `stop()` ends it
without emitting `finished`, and `start()` restarts the original buffer.

Call the following controls later in response to application state; they are
not a sequence:

```ts
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

### Established-call re-INVITEs

An established call accepts a compatible SDP offer with an unchanged destination
or a changed remote IPv4 address and/or audio port. The SDK validates the complete
offer, updates the destination used by subsequent audio and DTMF, and responds
with 200 OK containing its current local SDP. The call session, local socket/port,
SRTP state, RTP counters, peer identities and local hold configuration are retained.
No application callback or additional `invite`/`answered` event is required.

The configured codec and RTP payload mapping, negotiated remote SRTP cipher/key,
and remote media direction remain fixed. Additional optional codecs and harmless
SDP version/order/format changes are allowed; omitted direction means `sendrecv`.
Unsupported changes, unusable media parameters, and missing SDP offers receive
488 Not Acceptable Here, preserving the existing call and destination atomically.
Offerless initial inbound calls retain their existing ACK-supplied SDP behavior;
offerless re-INVITEs are unsupported.

This re-INVITE behavior applies only to tracked established sessions. Minimal
incoming-invitation tracking supports caller cancellation before answering; it
does not add initial INVITE deduplication, full SIP dialog/tag or forking support,
ACK waiting/timeouts/retransmission management, or negotiation concurrency control.
Overlapping negotiations, including local hold/unhold or signaling recovery, remain
unhandled; the SDK adds no 491 response, negotiation queue or automatic retry.
Controlled SIP/socket tests cover this behavior. Live RingCentral takeover
verification remains deferred until the external calling/486 issue is resolved;
those tests do not prove live takeover or actual network delivery.

### Debugging

```ts
softphone.enableDebugMode();
```

Debug mode prints complete SIP exchanges, which can contain identities, phone
numbers, call metadata, authentication material, and SRTP key material advertised
in SDP. Do not enable it in production or publish its output without redacting
sensitive values.

The initial `register()` call rejects if registration fails. Listen for
`signalingError` to handle later signaling failures, such as a lost
connection or a failed registration refresh:

```ts
softphone.on("signalingError", (error) => {
  console.error("Signaling failure", error);
});
```

After a registered Softphone loses its SIP signaling connection, it reconnects
and registers again automatically. Active UDP/SRTP media continues during
recovery for up to five minutes, but signaling operations fail immediately and
are not replayed. After replacement registration, each pre-existing call sends
an unchanged-SDP re-INVITE to reconcile its SIP dialog with the new connection.
The call is disposed if that request fails or receives no final response within
32 seconds. SIP dialog liveness and UDP/SRTP media liveness remain independent.

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

### Outbound call emits `non2xxResponse`

The destination did not answer with a final 2xx response. The SDK reports the
final SIP status code and reason phrase, such as `486 Busy Here` or
`603 Decline`, without classifying the outcome; your application decides what
the status means. Confirm that:

- The destination includes its country code and is valid.
- The device has a valid **Emergency Address** in the RingCentral portal.

The SDK emits `non2xxResponse` once and disposes the outbound call session.

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

The integration tests under `tests/e2e/` use two SIP accounts. Put them in
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

# Available external callee for the signaling-only transfer scenario:
ANOTHER_CALLEE_FOR_TESTING=1650...
```

Run it with:

```bash
NODE_OPTIONS='--import tsx --import ./demos/load-env.ts' pnpm test:e2e
```

The suite runs serially. Avoid overlapping local runs and hosted CI against the
same accounts. Missing credentials or an unavailable external callee fail the
affected scenario; they are not successful verification.

The transfer scenario calls the external callee from A, then transfers that call
to B. B answers and initiates hangup, including in failure cleanup. It checks
signaling only and makes no audio assertion on any leg. Separate audio tests do
not prove transferred audio. CI supplies the external callee through the
`ANOTHER_CALLEE_FOR_TESTING` repository secret.

## Development

Use Node.js 26 and pnpm 12.20.0 for contributor tooling and CI validation.
These tool versions do not set a new minimum runtime for SDK consumers.

Install dependencies with the declared package manager:

```bash
pnpm install --frozen-lockfile
```

Format and lint the project:

```bash
pnpm exec biome check --write .
```

Run the pull-request-safe validation suite:

```bash
pnpm validate
```

Documentation builds and CI use Python 3.15. Create an isolated environment, then install and serve the documentation:

```bash
python3.15 -m venv .venv
source .venv/bin/activate
python -m pip install -r mkdocs/requirements.txt
mkdocs serve -f mkdocs/mkdocs.yml
```

Build documentation strictly:

```bash
mkdocs build --strict -f mkdocs/mkdocs.yml
```
