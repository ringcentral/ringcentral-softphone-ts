import assert from "node:assert/strict";
import Softphone, * as packageNamespace from "ringcentral-softphone";

assert.equal(typeof Softphone, "function");
assert.deepEqual(Object.keys(packageNamespace), ["default"]);

await assert.rejects(
  import("ringcentral-softphone/call-session/index"),
  (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
);
