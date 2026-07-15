# Advanced Usage

## Observe SIP messages

Enable built-in logging:

```ts
softphone.enableDebugMode();
```

Or observe supported message events directly:

```ts
softphone.on("message", (message) => {
  console.log("Inbound SIP subject:", message.subject);
});

softphone.on("outboundMessage", (message) => {
  console.log("Outbound SIP message:", message);
});
```

For multiple instances, set both debug prefixes:

```ts
softphone.enableDebugMode({
  inboundPrefix: "Instance A receiving...\n",
  outboundPrefix: "Instance A sending...\n",
});
```

## Observe and forward RTP

`rtpPacket` emits decrypted RTP before audio decoding. `sendPacket()` encrypts a
packet for the destination session, providing a supported forwarding hook:

```ts
callSession1.on("rtpPacket", (packet) => {
  if (packet.header.payloadType === softphone.codec.id) {
    callSession2.sendPacket(packet);
  }
});
```

Do not access sockets, SRTP state, codec workers, peers, counters, or helper
methods directly; they are implementation details.

## Run multiple instances

Several instances can register with the same credentials, but only the most
recent instance receives inbound calls. See the
[multiple-instances demo](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/multi-instances.ts).

## Use telephony IDs

Outbound sessions expose `sessionId` and `partyId`, parsed from the
`p-rc-api-ids` SIP header:

```ts
callSession.once("answered", () => {
  console.log(callSession.sessionId, callSession.partyId);
});
```

RingCentral does not include these values in the initial inbound invite. For
inbound calls, see the
[call-ID workaround](https://github.com/tylerlong/rc-softphone-call-id-test).

## Handle TLS certificates

Certificate verification is enabled by default. Fix the certificate chain for
production. A trusted, controlled lab can opt out temporarily:

```ts
const softphone = new Softphone({
  // SIP credentials...
  ignoreTlsCertErrors: true,
});
```

This setting permits man-in-the-middle attacks and must not be used in
production.

## Join conferences

Conference creation and management use the RingCentral REST API and are outside
this SDK's scope. The SDK can still dial a conference and send its access code
with DTMF. See the maintained
[meeting demo](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/join-rcv-meeting.ts)
and the
[conference integration demo](https://github.com/tylerlong/softphone-invite-agent-to-conference-demo).

## Current limitations

- Only the most recent registration receives inbound calls when credentials are
  shared by several instances.
- Inbound invites do not expose RingCentral telephony session or party IDs.
- Caller-ID selection through `P-Asserted-Identity` is not supported.
- Audio files must already match the selected codec's raw input format.
- Conference orchestration belongs to the RingCentral REST API, not this SDK.

The SDK relies on the initial RTP packet to establish the local media endpoint,
so applications do not configure or advertise a separate local UDP port.
