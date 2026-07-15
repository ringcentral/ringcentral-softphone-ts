# DTMF

## Send one character

`sendDTMF()` accepts `0-9`, `*`, `#`, and `A-D`.

```ts
callSession.sendDTMF("1");
```

## Send a sequence

`sendDTMFs()` validates every character and waits after each one. The default
delay is 500 milliseconds.

```ts
await callSession.sendDTMFs("101#", 500);
```

This is useful for conference access codes and interactive voice response
menus.

## Receive DTMF

Use `dtmf` for decoded characters:

```ts
callSession.on("dtmf", (digit) => {
  console.log("DTMF:", digit);
});
```

Use `dtmfPacket` only when the underlying telephone-event RTP packet is needed:

```ts
callSession.on("dtmfPacket", (packet) => {
  console.log("Telephone-event payload bytes:", packet.payload.length);
});
```

For a conference dialing example, see
[`demos/join-rcv-meeting.ts`](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/join-rcv-meeting.ts).
