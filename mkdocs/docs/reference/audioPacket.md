# callSession.on('audioPacket', callback)

## Callback inputs

| Parameter   | Description |
|-------------|-------------|
| `rtpPacket` |             |

## Sample

```ts
callSession.on("rtpPacket", (rtpPacket: RtpPacket) => {
	// do something
});
```

