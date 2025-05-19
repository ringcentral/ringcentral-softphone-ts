---
hide:
  - navigation
title: RingCentral's Cloud Phone SDK - a TypeScript/JavaScript SDK to monitor, record and manipulate live phone calls
---

# RingCentral Cloud Phone SDK

The RingCentral Cloud Phone SDK helps developers connect to authorized live
phone calls in a safe and secure way in order to access and/or manipulate a
call's audio stream. In the world of artificial intelligence, this SDK is a
critical tool in creating agents, extracting audio, injecting audio, generating
transcripts, and more.

[Get started with the Cloud Phone SDK](get-started.md){ .md-button }

## Supported Cloud Phone SDK features

<div class="grid cards" markdown>

- :material-record-rec:{ .lg .middle } Receive audio stream from peer
- :material-play:{ .lg .middle } Stream local audio to remote peer
- :material-phone-ring:{ .lg .middle } Receive inbound calls
- :material-phone:{ .lg .middle } Make outbound calls
- :material-dialpad:{ .lg .middle } Receive DTMF tones
- :material-dialpad:{ .lg .middle } Send DTMF tones
- :material-phone-off:{ .lg .middle } Reject inbound calls
- :material-cancel:{ .lg .middle } Cancel outbound calls
- :material-phone-hangup:{ .lg .middle } Hangup active calls
- :material-transfer-right:{ .lg .middle } Transfer calls

</div>

## Evolution of the SDK

This SDK began its life as the now-retired
[RingCentral Softphone SDK for JavaScript](https://github.com/ringcentral/ringcentral-softphone-js),
which was originally built on SIP over WebSocket (WSS) and used WebRTC for audio
handling.

To improve reliability, scalability, and audio security, we re-architected the
SDK from the ground up. The result was the
[RingCentral Softphone SDK for TypeScript](https://github.com/ringcentral/ringcentral-softphone-ts),
which adopted SIP over TLS and SRTP for encrypted audio transmission.

With the shift toward broader capabilities beyond a softphone, we've rebranded
it as the **RingCentral Cloud Phone SDK** — a modern, extensible foundation for
building real-time voice applications.
