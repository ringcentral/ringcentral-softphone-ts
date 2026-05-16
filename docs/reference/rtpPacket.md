# callSession.on('rtpPacket', callback)

## Callback inputs

| Parameter   | Description |
| ----------- | ----------- |
| `rtpPacket` |             |

## Sample

In the example below there are two active call sessions. The first one receives
the RTP packet, and then forwards to packet to the second call session.

```ts
callSession.on("rtpPacket", (rtpPacket: RtpPacket) => {
  // received rtpPacket, and this packet may be about audio or dtmf
  // you should not assume it is about audio
});
```
