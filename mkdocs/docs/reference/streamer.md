# Streamer

`CallSession.streamAudio(buffer)` returns a `Streamer` and begins sending the
buffer immediately.

```ts
const streamer = callSession.streamAudio(audioBuffer);
```

The buffer must use the raw input format for the selected codec. See
[Audio](../guides/audio.md).

## Controls

| Method | Result | Description |
| --- | --- | --- |
| `start()` | `void` | Start from the beginning, or restart after completion. |
| `stop()` | `void` | Stop and discard the remaining buffered audio. |
| `pause()` | `void` | Pause sending without discarding the remainder. |
| `resume()` | `void` | Resume sending. |

## State

| Property | Type | Description |
| --- | --- | --- |
| `paused` | `boolean` | Whether sending is paused. |
| `finished` | `boolean` | Whether the buffer is exhausted or the call session is disposed. |

## Events

| Event | Payload | Description |
| --- | --- | --- |
| `finished` | none | Natural playback reached the end of the buffer. `stop()` does not emit this event. |

```ts
streamer.once("finished", () => console.log("Audio sent"));
streamer.pause();
streamer.resume();
```

Pause the streamer while its call is on hold.
