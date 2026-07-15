# Audio

Call sessions emit received audio and can stream a `Buffer` to the remote peer.
The raw buffer format depends on the codec selected when constructing the
`Softphone`.

## Choose a codec

| Codec | Raw input and decoded output | Playback example |
| --- | --- | --- |
| `OPUS/16000` (default) | 16-bit signed little-endian PCM, 16 kHz, mono | `ffplay -autoexit -f s16le -ar 16000 -ac 1 audio.raw` |
| `OPUS/48000/2` | 16-bit signed little-endian PCM, 48 kHz, stereo | `ffplay -autoexit -f s16le -ar 48000 -ac 2 audio.raw` |
| `PCMU/8000` | 8-bit mu-law, 8 kHz, mono | `ffplay -autoexit -f mulaw -ar 8000 -ac 1 audio.raw` |

Set the codec during construction:

```ts
const softphone = new Softphone({
  // SIP credentials...
  codec: "PCMU/8000",
});
```

## Receive audio

For Opus codecs, `audioPacket.payload` contains decoded PCM. For PCMU, it
contains mu-law bytes.

```ts
import fs from "node:fs";

const output = fs.createWriteStream(`${callSession.callId}.raw`);

callSession.on("audioPacket", (packet) => {
  output.write(packet.payload);
});

callSession.once("disposed", () => output.close());
```

## Stream audio

Pass a complete raw audio buffer in the selected codec's input format.
Streaming begins immediately.

```ts
import fs from "node:fs";

const streamer = callSession.streamAudio(fs.readFileSync("audio.raw"));
streamer.once("finished", () => console.log("Audio sent"));
```

Control the stream synchronously:

```ts
streamer.pause();
streamer.resume();
streamer.stop();
streamer.start(); // restart from the beginning
```

Pause streaming while the call is on hold, then resume after unholding.

The repository contains small test buffers used by the maintained demos. See
the [Examples](../examples.md) page.
