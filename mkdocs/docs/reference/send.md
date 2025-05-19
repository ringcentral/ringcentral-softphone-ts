# callSession.send(message)

Transmits a message to remote peer. This is very low level API, you probably do
not need to invoke it directly.

Based on this method, the SDK implements audio streaming and DTMF sending.

## Inputs

| Parameter | Description                                                          |
| --------- | -------------------------------------------------------------------- |
| `message` | A string or [Buffer](https://nodejs.org/api/buffer.html) to transmit |

## Outputs

None.
