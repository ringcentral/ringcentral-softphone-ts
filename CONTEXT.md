# Softphone SDK

The Softphone SDK places and receives phone calls while carrying their audio and DTMF media.

## Language

**Call session**:
A live inbound or outbound phone call that owns its per-call SIP policy, coordinates its media transport, and exposes call controls and call-level events.
_Avoid_: Media session

**Media transport**:
The per-call channel that owns the bound UDP and SRTP lifecycle carrying audio and DTMF between the Softphone SDK and the remote peer.
_Avoid_: Media session

**SIP signaling connection**:
The TLS connection carrying registration and call-control messages for one Softphone instance, separately from per-call media.

**SIP message**:
A mutable SIP request or response exchanged through the SIP signaling connection.

**Streamer**:
A controller that sends one PCM audio buffer through a call's media transport at the required pace.
_Avoid_: Player
