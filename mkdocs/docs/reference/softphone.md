# Softphone

`Softphone` owns the TLS SIP connection, registration, and call creation.

```ts
import Softphone from "ringcentral-softphone";
```

## Constructor options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `domain` | `string` | Yes | SIP domain without a port. |
| `outboundProxy` | `string` | Yes | Regional TLS proxy including its port. |
| `username` | `string` | Yes | SIP username. |
| `password` | `string` | Yes | SIP password. |
| `authorizationId` | `string` | Yes | SIP authorization ID. |
| `codec` | `"OPUS/16000" \| "OPUS/48000/2" \| "PCMU/8000"` | No | Defaults to `OPUS/16000`. |
| `ignoreTlsCertErrors` | `boolean` | No | Defaults to `false`; use `true` only in controlled development environments. |

## Methods

| Method | Result | Description |
| --- | --- | --- |
| `register()` | `Promise<void>` | Connect and register. Registration refreshes until `revoke()` is called. |
| `revoke()` | `void` | Stop registration, remove listeners, and close the TLS connection. |
| `enableDebugMode(options?)` | `void` | Log inbound and outbound SIP. When provided, `options` contains both `inboundPrefix` and `outboundPrefix`. |
| `answer(inviteMessage)` | `Promise<InboundCallSession>` | Answer an inbound invite and return its session. |
| `decline(inviteMessage)` | `Promise<void>` | Decline an inbound invite with SIP status 603. |
| `call(callee)` | `Promise<OutboundCallSession>` | Start an outbound call to a country-code-qualified destination. |

## Events

| Event | Payload | Description |
| --- | --- | --- |
| `invite` | `InboundMessage` | A new inbound call can be answered or declined. |
| `message` | `InboundMessage` | Every parsed inbound SIP message. This is the supported SIP observation hook. |
| `outboundMessage` | `string` | Every serialized outbound SIP message. This is the supported outbound observation hook. |
| `registrationError` | `Error` | A background registration refresh failed. The initial `register()` call rejects directly on failure. |

## Observation properties

| Property | Type | Description |
| --- | --- | --- |
| `sipInfo` | `SoftPhoneOptions` | Active SIP configuration. It contains credentials and must be treated as sensitive. |
| `codec.id` | `number` | RTP payload type for the selected audio codec; useful for filtering packets before forwarding. |

The TLS socket, codec workers, fake addressing values, and registration timers
are implementation details, not consumer API.
