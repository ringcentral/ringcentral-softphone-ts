# Audio & DTMF

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

For Opus codecs, the `audio` event provides decoded PCM. For PCMU, it provides
mu-law bytes. The event payload is a `Buffer`.

```ts
import fs from "node:fs";

const output = fs.createWriteStream(`${callSession.callId}.raw`);

callSession.on("audio", (audio) => {
  output.write(audio);
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

Call these synchronous controls later in response to application state; they
are not a sequence:

```ts
streamer.pause();
streamer.resume();
streamer.stop();
streamer.start(); // restart from the beginning
```

Pause streaming while the call is on hold, then resume after unholding.

## Send DTMF

DTMF characters are limited to `0-9`, `*`, and `#`. Send one character
immediately:

```ts
callSession.sendDTMF("1");
```

Send a sequence with a delay after each character. The default delay is 500
milliseconds:

```ts
await callSession.sendDTMFs("101#", 500);
```

## Receive DTMF

```ts
callSession.on("dtmf", (digit) => {
  console.log("DTMF:", digit);
});
```

For complete call flows, see the [Demos](../examples.md) page, including the
[meeting example](https://github.com/ringcentral/ringcentral-softphone-ts/blob/main/demos/join-rcv-meeting.ts).
