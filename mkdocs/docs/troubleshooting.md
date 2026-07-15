# Troubleshooting

## Outbound call emits `busy`

SIP status 486 means the destination is busy or cannot be reached. Confirm that:

- The destination includes its country code and is valid.
- The device has a valid **Emergency Address** in the
  [RingCentral portal](https://service.ringcentral.com).

The SDK emits `busy` and disposes the outbound call session.

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
`register()` call rejects on failure; later refresh failures emit
`registrationError`.

## Audio is distorted or silent

The input to `streamAudio()` must match the selected codec exactly. Check the
sample format, sample rate, and channel count on the [Audio](guides/audio.md)
page. The SDK does not resample or convert files.

## Inbound telephony IDs are missing

RingCentral does not include session and party IDs in the initial inbound
invite. They are exposed only on outbound call sessions. For an inbound-call
alternative, see the
[call-ID workaround](https://github.com/tylerlong/rc-softphone-call-id-test).
