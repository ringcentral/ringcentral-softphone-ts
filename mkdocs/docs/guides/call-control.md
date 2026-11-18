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

## Incoming caller cancellation

An incoming invitation belongs to the Softphone that emitted it and is pending
until answered, declined, or canceled. `answer()` and `decline()` reject canceled,
already consumed, foreign, or otherwise no-longer-pending invitations. An answer
also rejects if the caller cancels before answering completes.

Listen for `inviteCanceled` to dismiss the ringing UI using the exact original,
opaque `InboundInvite` object. Caller cancellation applies to pending invitations;
an established call ends through normal hangup.

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
other status means for it. An `answered` callback can immediately hang up, and a
`non2xxResponse` callback can revoke signaling if the application is done.
Provisional responses keep the call pending. After the peer answers, use the
task-specific controls below and hang up when the application is finished with
the call.

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

When the remote peer hangs up, the session releases its audio resources and
emits `disposed`. A `disposed` callback can revoke signaling if the application
no longer needs the registration.

Transfer an active call:

```ts
try {
  await callSession.transfer("16505550101");
  console.log("Transfer completed");
} catch (error) {
  console.error("Transfer failed:", error);
}
```

`transfer()` returns a `Promise<void>` that resolves when the transfer succeeds.
Acceptance of the transfer request and progress updates do not complete it.
An explicit request rejection or reported transfer failure rejects it. Failure
alone leaves the original call available unless that call also ends normally.
Disposal of the original session rejects a still-pending transfer.

Overlapping transfers are rejected; another transfer can start after the previous
one completes or fails. There is no built-in transfer timeout. If no final outcome
arrives and the call remains open, the Promise can stay pending.

## Hold and unhold

```ts
await callSession.hold();
await callSession.unhold();
```

Hold isolates peer audio in both directions until unhold restores it. If audio
is being streamed to the peer, pause its `Streamer` while the call is on hold.

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

## Automatic media updates

The SDK handles compatible remote media address or port updates on an existing
call without emitting another `invite` or `answered` event. Continue using the
same call session. Codec changes, remote encryption key changes, remote hold
negotiation, and overlapping negotiations are not supported by this mechanism.
Unsupported updates leave the existing media configuration unchanged.

## Registration lifecycle

Register before placing calls, and install inbound listeners before registering.
Keep the registration active to receive additional calls. Hang up active calls
before calling `softphone.revoke()` when the application is done; revocation
closes signaling and stops automatic recovery, rather than hanging up calls.
For connection failures, see [recovery behavior](../troubleshooting.md#connection-loss-and-recovery).
