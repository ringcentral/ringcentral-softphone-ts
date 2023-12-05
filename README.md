# RingCentral Softphone SDK for TypeScript

This is a TypeScript SDK for RingCentral Softphone. It is a complete rewrite of the [RingCentral Softphone SDK for JavaScript](https://github.com/ringcentral/ringcentral-softphone-js)

Users are recommended to use this SDK instead of the JavaScript SDK.



## Notes

### How to play saved audio file

```
ffplay -autoexit -f mulaw -ar 8000 test.raw
```

Or

```
play -b 8 -r 8000 -e mu-law test.raw
```


## Todo

- outbound call
- send dtmf
- Try other payload types, such as OPUS
