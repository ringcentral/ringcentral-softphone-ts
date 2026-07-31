import packageNamespace = require("ringcentral-softphone");
import type {
  CallSession,
  InboundInvite,
  OutboundCallSession,
  SoftphoneOptions,
  Streamer,
} from "ringcentral-softphone";

const Softphone = packageNamespace.default;
declare const options: SoftphoneOptions;

const softphone = new Softphone(options);
softphone.on("invite", (invite: InboundInvite) => {
  const answer: Promise<CallSession> = softphone.answer(invite);
  void answer;
});

// @ts-expect-error CommonJS consumers access the constructor through `.default`.
new packageNamespace(options);
