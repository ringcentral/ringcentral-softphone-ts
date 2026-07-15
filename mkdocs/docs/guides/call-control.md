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
  callSession.on("audioPacket", (packet) => {
    console.log("Received audio bytes:", packet.payload.length);
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

Hold stops receiving remote audio through a SIP re-invite. If audio is being
streamed to the peer, pause its `Streamer` while the call is on hold.

See the complete maintained
[inbound](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/inbound-call.ts)
and
[outbound](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/outbound-call.ts)
demos.
