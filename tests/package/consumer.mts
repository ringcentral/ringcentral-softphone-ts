import Softphone, {
  type CallSession,
  type InboundInvite,
  type OutboundCallSession,
  type SoftphoneOptions,
  type Streamer,
} from "ringcentral-softphone";

const options: SoftphoneOptions = {
  outboundProxy: "sip.example.com:5096",
  domain: "example.com",
  username: "1001",
  password: "secret",
  authorizationId: "authorization-id",
};

const softphone = new Softphone(options);

const handleInvite = async (invite: InboundInvite) => {
  const session: CallSession = await softphone.answer(invite);
  session.on("audio", (audio: Buffer) => {
    void audio;
  });
  session.once("dtmf", (digit) => {
    const keypadDigit:
      | "0"
      | "1"
      | "2"
      | "3"
      | "4"
      | "5"
      | "6"
      | "7"
      | "8"
      | "9"
      | "*"
      | "#" = digit;
    void keypadDigit;
  });
  session.once("disposed", () => {});

  const streamer: Streamer = session.streamAudio(Buffer.alloc(320));
  streamer.once("finished", () => {});
  streamer.pause();
  streamer.resume();
};

softphone.on("invite", handleInvite);
softphone.once("registrationError", (error: Error) => {
  void error;
});
softphone.on("custom-event", () => {});
softphone.eventNames();

const outboundFlow = async () => {
  await softphone.register();
  const session: OutboundCallSession = await softphone.call("1002");
  session.once("answered", () => {
    session.sendDTMF("#");
  });
  session.once("busy", () => {});
  session.listenerCount("audio");
  await session.hangup();
  softphone.revoke();
};

void outboundFlow;
