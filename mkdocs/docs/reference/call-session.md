# CallSession

`Softphone.answer()` returns an inbound call session. `Softphone.call()` returns
an outbound call session. Both share the controls and events below; outbound-only
members are marked explicitly.

## Methods

| Method | Result | Description |
| --- | --- | --- |
| `hangup()` | `Promise<void>` | Hang up an active call. |
| `sendDTMF(char)` | `void` | Send one of `0-9`, `*`, `#`, or `A-D`. |
| `sendDTMFs(chars, delay?)` | `Promise<void>` | Send validated characters with a 500 ms default delay after each one. |
| `streamAudio(buffer)` | [`Streamer`](streamer.md) | Immediately start sending raw audio in the selected codec's input format. |
| `sendPacket(rtpPacket)` | `void` | Forward a received RTP packet to this session. |
| `transfer(destination)` | `Promise<void>` | Transfer an active call and resolve after a successful SIP notification. |
| `hold()` | `Promise<void>` | Stop receiving remote audio through a SIP re-invite. |
| `unhold()` | `Promise<void>` | Resume receiving remote audio. |
| `cancel()` | `Promise<void>` | Cancel before the peer answers. Outbound only. |

## Properties

| Property | Type | Description |
| --- | --- | --- |
| `callId` | `string` | SIP Call-ID. |
| `disposed` | `boolean` | Whether the session has been disposed. |
| `sessionId` | `string` | RingCentral telephony session ID. Outbound only. |
| `partyId` | `string` | RingCentral telephony party ID. Outbound only. |

## Events

| Event | Payload | Description |
| --- | --- | --- |
| `answered` | none | The peer answered. Outbound only. |
| `busy` | none | The destination returned SIP 486; the session is then disposed. Outbound only. |
| `disposed` | none | The session closed and its media resources were released. |
| `audioPacket` | `RtpPacket` | Received audio. The payload has been decoded for the selected codec. |
| `dtmf` | `string` | A decoded DTMF character. |
| `dtmfPacket` | `RtpPacket` | A telephone-event RTP packet. |
| `rtpPacket` | `RtpPacket` | Any decrypted incoming RTP packet, emitted before audio decoding. |

`rtpPacket` and `sendPacket()` are the supported observation and forwarding
hooks. Raw socket writes, SRTP state, codec workers, peer fields, sequence
counters, and helper methods are implementation details.
