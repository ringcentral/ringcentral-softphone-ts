# callSession.on('dtmf', callback)

## Callback inputs

| Parameter | Description                  |
| --------- | ---------------------------- |
| `dtmf`    | The key pressed by the user. |

## Sample

```ts
callSession.on("dtmf", (dtmf) => {
	console.log("The user pressed the " + dtmf + " key.");
});
```
