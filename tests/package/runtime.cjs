const assert = require("node:assert/strict");
const packageNamespace = require("ringcentral-softphone");

assert.equal(typeof packageNamespace.default, "function");
assert.deepEqual(Object.keys(packageNamespace), ["default"]);
assert.throws(
  () => require("ringcentral-softphone/call-session/index"),
  (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
);
