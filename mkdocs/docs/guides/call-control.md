# Calls

Register the `invite` listener before calling `register()` for inbound calls.
Use a country-code-qualified destination for outbound calls.

## Answer an inbound call

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

`answer()` resolves to the `CallSession` used for media and call control.

## Decline an inbound call

```ts
softphone.on("invite", async (inviteMessage) => {
  await softphone.decline(inviteMessage);
});
```

The SDK responds with SIP status 603, which applies only to the callee leg
RingCentral presented to you. RingCentral may already have answered the
caller-facing leg before your device was presented the call, so after your
decline the caller can remain in an answered call: it receives neither
`non2xxResponse` nor a `disposed` event, and RingCentral may continue routing
the call, for example toward voicemail. The caller's application decides when
to hang up.

## Place an outbound call

```ts
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

A final 2xx INVITE response emits `answered` and keeps the session. A matching
final 3xx–6xx response emits `non2xxResponse` with the SIP status code and
reason phrase, and then the session is disposed. The SDK reports the response
without classifying it, so your application decides what 486, 487, 603, or any
other status means for it. Later provisional (1xx) responses keep the call
pending. After the peer answers, use the task-specific controls below and hang
up when the application is finished with the call.

For RingCentral-to-RingCentral calls, RingCentral may answer your leg (emitting
`answered`) before the callee's device is presented the call. If the callee
declines, your session stays answered and emits neither `non2xxResponse` nor
`disposed`; hang up when your application is done with the call.

## Cancel, hang up, and transfer

Cancel before the peer answers:

```ts
await callSession.cancel();
```

Hang up an active call:

```ts
await callSession.hangup();
```

Transfer an active call:

```ts
await callSession.transfer("16505550101");
```

## Hold and unhold

```ts
await callSession.hold();
await callSession.unhold();
```

Hold temporarily stops receiving remote audio. If audio is being streamed to
the peer, pause its `Streamer` while the call is on hold.

## Telephony session and party IDs

Outbound sessions expose optional `sessionId` and `partyId` values after
RingCentral supplies them:

```ts
callSession.once("answered", () => {
  console.log(callSession.sessionId, callSession.partyId);
});
```

RingCentral does not include these values in the initial inbound invite. For
inbound calls, see the
[call-ID workaround](https://github.com/tylerlong/rc-softphone-call-id-test).

## Multiple instances

Several instances can register with the same credentials, but only the most
recent instance receives inbound calls. See the
[multiple-instances demo](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/multi-instances.ts).

## Meetings

Conference creation and management use the RingCentral REST API and are outside
this SDK's scope. The SDK can still dial a meeting and send its access code with
DTMF. See the
[meeting demo](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/join-rcv-meeting.ts)
and the
[conference integration demo](https://github.com/tylerlong/softphone-invite-agent-to-conference-demo).

## Limitations

- Only the most recent registration receives inbound calls when credentials
  are shared by several instances.
- Inbound invites do not provide RingCentral telephony session or party IDs.
- Selecting a custom caller ID is not supported.
- Conference orchestration belongs to the RingCentral REST API, not this SDK.

See the complete maintained
[inbound](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/inbound-call.ts)
and
[outbound](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/outbound-call.ts)
demos.
