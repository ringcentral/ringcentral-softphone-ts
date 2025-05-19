---
hide:
  - navigation
---
# Support 

<div class="grid cards" markdown>

-   [:material-forum: Get help from the community](https://community.ringcentral.com/developer-platform-apis-integrations-5)
-   [:simple-github: File a bug report](https://github.com/ringcentral/ringcentral-softphone-ts/issues)

</div>

## Troubleshooting common issues

### How to retrieve the telephony session ID

For outbound calls, you will be able to find header like the following from the `callSession.sipMessage.headers` property:

```
p-rc-api-ids: party-id=p-a0d17e323f0fez1953f50f90dz296e3440000-1;session-id=s-a0d17e323f0fez1953f50f90dz296e3440000
```

However, for inbound calls, the server doesn't tell us anything about the Telephony Session ID for which there is a [workaround solution](https://github.com/tylerlong/rc-softphone-call-id-test).



### How to handle the "SIP/2.0 486 Busy Here" message for outbound calls

Check the following if you receive this error:

* Make sure that the target number is valid. If the target number is invalid, you will get `SIP/2.0 486 Busy Here`.
* Make sure that the device has a "Emergency Address" configured in the RingCentral Admin Portal.
* Make sure there are no complaints about the selected emergency address by checking the details of the device. If the Emergency Address is not configured properly, outbound call will not work.
