# Troubleshooting

## Outbound call emits `non2xxResponse`

The destination did not answer with a final 2xx response. The SDK reports the
final SIP status code and reason phrase, such as `486 Busy Here` or
`603 Decline`, without classifying the outcome; your application decides what
the status means. Confirm that:

- The destination includes its country code and is valid.
- The device has a valid **Emergency Address** in the
  [RingCentral portal](https://service.ringcentral.com).

The SDK emits `non2xxResponse` once and disposes the outbound call session.

## Only one instance receives inbound calls

This is expected when several instances register with the same credentials.
Only the most recent registration receives inbound calls.

## TLS certificate validation fails

Fix the certificate chain for production. A trusted, controlled development
environment can set `ignoreTlsCertErrors: true` temporarily. This disables
certificate verification, permits man-in-the-middle attacks, and must not be
used in production.

## Registration fails

Check all five credential values:

- Use the SIP domain without its port.
- Use a regional `proxyTLS` value including its port as `outboundProxy`.
- Use the username, password, and authorization ID for an **Existing Phone**
  device (`OtherPhone` in the REST API).
- Do not use a RingCentral app device (`SoftPhone` in the REST API).

Call `softphone.enableDebugMode()` to inspect the SIP exchange. The initial
`register()` call rejects on failure; later signaling failures, such as a
connection loss, a registration-refresh failure, or a failed recovery
attempt, emit `signalingError`. Debug output can contain identities, phone
numbers, call metadata, authentication material, and SRTP key material advertised
in SDP, so redact it before sharing.

## Audio is distorted or silent

The input to `streamAudio()` must match the selected codec exactly. Check the
sample format, sample rate, and channel count on the
[Audio & DTMF](guides/audio.md) page. The SDK does not resample or convert
files.

## Inbound telephony IDs are missing

RingCentral does not include session and party IDs in the initial inbound
invite. They are exposed only on outbound call sessions. For an inbound-call
alternative, see the
[call-ID workaround](https://github.com/tylerlong/rc-softphone-call-id-test).

## Connection loss and recovery

After a successful registration, the SDK automatically reconnects and registers
again if its signaling connection fails. The connection loss and each failed
recovery attempt emit `signalingError`:

```ts
softphone.on("signalingError", (error) => {
  console.error("Signaling failure:", error);
});
```

Call-control operations attempted during recovery fail immediately. Interrupted
operations are not queued or replayed. Active audio can continue independently
for up to five minutes while signaling recovers; continued audio does not prove
that call controls are available. Calls are disposed when that recovery deadline
expires. After reconnecting, a call is also disposed if restoring its signaling
fails or receives no final response within 32 seconds. Handle `disposed` to
clean up application state.

Calling `softphone.revoke()` stops reconnection. The initial `register()` call
rejects on failure; automatic recovery applies after a successful registration.
