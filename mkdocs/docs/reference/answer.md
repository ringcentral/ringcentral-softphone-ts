# softPhone.answer()

Answers an incoming call so that you can attach yourself to it.

## Sample

```ts
softphone.on("invite", async (inviteMessage) => {
  const callSession = await softphone.answer(inviteMessage);
});
```

## Inputs

| Parameter       | Description                            |
| --------------- | -------------------------------------- |
| `inviteMessage` | A SIP invite message from remote peer. |

## Outputs

| Parameter     | Description           |
| ------------- | --------------------- |
| `callSession` | A callSession object. |
