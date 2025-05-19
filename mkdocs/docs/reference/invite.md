# cloudPhone.on('invite', callback)

## Callback inputs

| Parameter | Description          |
| --------- | -------------------- |
| `message` | A SIP invite message |

## Sample

```ts
cloudPhone.on("invite", (message) => {
	// received a SIP invige message, which means some one is calling you
});
```
