# Demos

The repository demos are maintained as executable TypeScript programs. This
page keeps only short patterns and links to those source files, avoiding copied
programs that can drift.

## Answer a call

```ts
softphone.on("invite", async (inviteMessage) => {
  const callSession = await softphone.answer(inviteMessage);
  callSession.once("disposed", () => softphone.revoke());
});
await softphone.register();
```

[View `demos/inbound-call.ts`](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/inbound-call.ts)

## Place a call

```ts
await softphone.register();
const callSession = await softphone.call("16505550100");
callSession.once("answered", () => console.log("Answered"));
callSession.once("busy", () => console.log("Busy or unreachable"));
callSession.once("disposed", () => softphone.revoke());
```

[View `demos/outbound-call.ts`](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/outbound-call.ts)

## Join a meeting with DTMF

```ts
import waitFor from "wait-for-async";

await waitFor({ interval: 6000 });
await callSession.sendDTMFs(`${accessCode}#`);
await waitFor({ interval: 6000 });
callSession.sendDTMF("#");
```

[View `demos/join-rcv-meeting.ts`](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/join-rcv-meeting.ts)

## Make calls sequentially

Wait for each session's `disposed` event before placing the next call.

[View `demos/multiple-calls-sequentially.ts`](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/multiple-calls-sequentially.ts)

## Run multiple instances

Give each instance distinct debug prefixes. Only the most recent registration
receives inbound calls when credentials are shared.

[View `demos/multi-instances.ts`](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/multi-instances.ts)

For conference orchestration, see the separate
[conference integration demo](https://github.com/tylerlong/softphone-invite-agent-to-conference-demo).
