# callSession.streamAudio()

Streams an audio buffer into a phone call's audio stream.

## Sample

```ts
const streamer = callSession.streamAudio( fs.readFileSync('demos/test.wav') )
```

## Inputs

| Parameter | Description                                               |
|-----------|-----------------------------------------------------------|
| `audio`   | A [Buffer](https://nodejs.org/api/buffer.html) to stream. |

## Outputs

| Parameter | Description                                               |
|-----------|-----------------------------------------------------------|
| `streamer`   | A [Streamer](#streamer) object. |

## Streamer object

The streamer object supports four methods, that do exactly as their names imply:

* `start()`
* `stop()`
* `pause()`
* `resume()`
