# callSession.on('answered', callback)

## Sample

```ts
callSession.once("answered", () => {
  // outbound callSession is answered
  // there is no such event for inbound call. Because for inbound call it is YOU who answer it
});
```
