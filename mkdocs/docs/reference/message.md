# cloudPhone.on('message', callback)

## Callback inputs

| Parameter | Description           |
| --------- | --------------------- |
| `message` | SIP messasge received |

## Sample

```ts
cloudPhone.on("message", (message) => {
	// received SIP message from server
});
```
