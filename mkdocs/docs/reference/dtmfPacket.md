# callSession.on('dtmfPacket', callback)

## Callback inputs

| Parameter    | Description |
| ------------ | ----------- |
| `dtmfPacket` |             |

## Sample

```ts
callSession.on("dtmfPacket", (dtmfPacket: DtmfPacket) => {
	// received a packet which is about DTMF
});
```
