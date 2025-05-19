# callSession.on('busy', callback)

This event is triggered when a call is made to an invalid number, or when the SIP server returns `SIP/2.0 486 Busy Here`. Upon triggering the busy event, the call session will be disposed of.

## Sample

```ts
callSession.on("busy", () => {
  // do something with the call
  console.log("cannot reach the callee number");
});
```

