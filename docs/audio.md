---
hide:
  - navigation
---
# Working with audio using the Cloud Phone SDK

Two of the Cloud Phone SDK's most popular uses is to gain direct access to the audio streams of a phone call. To see code samples for these two use cases, consult the links below. 

<div class="grid cards" markdown>

-   :material-record-circle-outline:{ .lg .middle } __Receive audio stream from peer__

    ---

    Tap into the audio stream of a phone call and pipe the stream to a file, or translator, or transcription engine.
    
    [:octicons-arrow-right-24: See example code](examples/record-audio.md)

-   :octicons-play-16:{ .lg .middle } __Stream local audio to remote peer__

    ---

	Tap into the audio stream of a phone call and inject your own custom audio. Play audio from a file, or stream audio from a speech synthesizer.

    [:octicons-arrow-right-24: See example code](examples/stream-audio.md)

</div>

## Selecting the right right audio codec

The Cloud Phone SDK supports the following audio codecs:

| Codec                  | Sample rate | Channels | Description                                                                   |
|------------------------|-------------|----------|-------------------------------------------------------------------------------|
| `OPUS/16000` (default) | 16 kHz      | Mono     | Best for telephony. High quality, but low bitrates and low latency            |
| `OPUS/48000/2`         | 48 kHz      | Stereo   | Best for music and full-band audio, but requires more bandwidth and CPU power |
| `PCMU/8000`            | 8 kHz       | Mono     | Widely supported in PSTN and SIP networks, but poorest overall audio quality  |

Here is a quick selection guide for common use cases:

| Scenario                            | Recommended codec |
|-------------------------------------|-------------------|
| Voice chat with good quality        | OPUS/16000        |
| High-fidelity stereo audio          | OPUS/48000/2      |
| Interoperability with legacy phones | PCMU/8000         |
| Mixed voice and music               | OPUS/48000/2      |
| Low-bandwidth VoIP                  | OPUS/16000        |

## Setting the audio codec

One is able to select their preferred audio codec when instantiating a Cloud Phone instance.

```ts
import Softphone from "ringcentral-softphone";

const softphone = new Softphone({
  codec: "PCMU/8000",
  // ...
});
```

## Working with audio codecs

### OPUS/16000

* The codec used between server and client is "OPUS/16000". This SDK will auto decode/encode the codec to/from "uncompressed PCM".
* The bitrate is 16, which means 16 bits per sample. Sample rate is 16000, which means 16000 samples per second. Encoding is "signed-integer".

You may play saved audio using the following commands.

=== "play command"

    ```
    play -t raw -b 16 -r 16000 -e signed-integer test.wav
    ```
    
    !!! hint "To stream an audio file to remote peer, you need to make sure that the audio file is playable by the command above."

=== "ffmpeg command"

    ```
    ffplay -autoexit -f s16le -ar 16000 test.wav
    ```

### PCMU/8000

If you choose this codec, make sure audio is playable using the following command:

=== "play command"

    ```
    play -b 8 -r 8000 -e mu-law test.raw
    ```

    !!! warning "If the file's extension is `.wav`, then `play` will complain"
	    ```
        play FAIL formats: can't open input file `6fdbbf2f-74fe-437a-b5a7-80c0c546baf0.wav': WAVE: RIFF header not found
        ```
		To fix, change the file extension to `.raw` or use `ffplay` instead.

=== "ffplay command"

    ```
    ffplay -autoexit -f mulaw -ar 8000 test.wav
    ```

### OPUS/48000/2

If you choose this codec, make sure audio is playable using the following command:

=== "play command"
    ```
    play -t raw -b 16 -r 48000 -e signed-integer -c 2 test.wav
    ```

## Generating an audio file for testing

=== "MacOS"

    ```
    say "Hello world" -o test.wav --data-format=LEI16@16000
    ```

=== "Windows"

    !!! question "Please consider contributing an example command to help Windows users"

=== "Linux"

    !!! question "Please consider contributing an example command to help Linux users"
