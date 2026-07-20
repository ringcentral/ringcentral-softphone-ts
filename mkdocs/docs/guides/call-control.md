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

The SDK responds with SIP status 603.

## Place an outbound call

```ts
await softphone.register();
const callSession = await softphone.call("16505550100");

callSession.once("answered", async () => {
  console.log("Call answered");
  callSession.sendDTMF("1");
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

SIP status 486 causes the outbound session to emit `busy` and then be disposed.

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
