# Implementation notes

These notes describe protocol mechanics for SDK maintainers. Application-facing
behavior belongs in the [user guides](../mkdocs/docs/index.md). Development and
test setup belongs in [Contributing](../CONTRIBUTING.md).

## SIP replies and application callbacks

- Outbound calls send the required ACK before emitting `answered` or
  `non2xxResponse`. Later provisional responses keep the call pending.
- Incoming cancellation sends `200 OK` to CANCEL and `487 Request Terminated`
  to the pending INVITE before emitting `inviteCanceled` with the original
  invitation object. Cancellation does not dispose an established call; BYE
  ends it.
- Remote BYE receives `200 OK` before media is released and `disposed` is
  emitted. If the local reply send throws, `signalingError` is emitted and
  the ended call is still released.
- Matching transfer NOTIFY requests receive a reply before the transfer Promise
  settles, including failure notifications.

These reply sends are fire-and-forget and do not confirm network delivery.
Callback ordering permits applications to hang up or revoke signaling without
preventing the preceding reply from being sent locally.

## Local SRTP keys

Each call independently generates fresh local SRTP key material to encrypt and
authenticate its outgoing audio and DTMF. Keys are isolated across concurrent and
sequential calls, including calls on different Softphone instances. The same call
retains its key through hold/unhold, supported media destination updates, and SIP
signaling recovery. Exposure of one call's key does not expose other calls' keys,
but it can expose that call's captured outgoing media.

## Established-call re-INVITEs

An INVITE whose exact Call-ID matches a tracked established inbound or outbound
call is handled internally, even if its To/From tags differ. It reuses the
existing call session and media transport.

An established call accepts a compatible SDP offer with an unchanged destination
or a changed remote IPv4 address and/or audio port. The SDK validates the complete
offer, updates the destination used by subsequent audio and DTMF, and responds
with 200 OK containing its current local SDP. The call session, local socket/port,
SRTP state, RTP counters, peer identities and local hold configuration are retained.
No application callback or additional `invite`/`answered` event is required.

The configured codec and RTP payload mapping, negotiated remote SRTP cipher/key,
and remote media direction remain fixed. Additional optional codecs and harmless
SDP version/order/format changes are allowed; omitted direction means `sendrecv`.
Unsupported changes, unusable media parameters, and missing SDP offers receive
488 Not Acceptable Here, preserving the existing call and destination atomically.
Offerless initial inbound calls retain their existing ACK-supplied SDP behavior;
offerless re-INVITEs are unsupported.

This re-INVITE behavior applies only to tracked established sessions. Minimal
incoming-invitation tracking supports caller cancellation before answering; it
does not add initial INVITE deduplication, full SIP dialog/tag or forking support,
ACK waiting/timeouts/retransmission management, or negotiation concurrency control.
Overlapping negotiations, including local hold/unhold or signaling recovery, remain
unhandled; the SDK adds no 491 response, negotiation queue or automatic retry.

## Signaling recovery

After a registered Softphone loses its SIP signaling connection, it reconnects
and registers again automatically. Active UDP/SRTP media continues during
recovery for up to five minutes, but signaling operations fail immediately and
are not replayed. After replacement registration, each pre-existing call sends
an unchanged-SDP re-INVITE to reconcile its SIP dialog with the new connection.
The call is disposed if that request fails or receives no final response within
32 seconds. SIP dialog liveness and UDP/SRTP media liveness remain independent.

## Verification evidence

Controlled SIP/socket tests exercise protocol behavior; they do not by themselves
prove live takeover, bidirectional audio, or actual network delivery. See the
[dated SIP exchange verification](validation/2026-11-18-sip-exchanges.md) for
cancellation and transfer observations and their limits. Keep verification status
in dated reports rather than in the SDK quick start.
