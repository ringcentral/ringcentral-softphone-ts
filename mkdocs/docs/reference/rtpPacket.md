# callSession.on('rtpPacket', callback)

## Callback inputs

| Parameter   | Description |
|-------------|-------------|
| `rtpPacket` |             |

## Sample

In the example below there are two active call sessions. The first one receives the RTP packet, and then forwards to packet to the second call session. 

```ts
callSession.on("rtpPacket", (rtpPacket: RtpPacket) => {
  // if statement is to make sure that it is an audio packet
  if (rtpPacket.header.payloadType === softphone.codec.id) {
    callSession2.sendPacket(rtpPacket);
  }
});
```

