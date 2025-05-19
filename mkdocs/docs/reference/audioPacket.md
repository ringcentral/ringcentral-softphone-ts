# callSession.on('audioPacket', callback)

## Callback inputs

| Parameter   | Description |
| ----------- | ----------- |
| `rtpPacket` |             |

## Sample

```ts
callSession.on("audioPacket", (rtpPacket: RtpPacket) => {
	// received a rtpPacket which is audio data
});
```
