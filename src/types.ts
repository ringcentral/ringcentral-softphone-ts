import type { Buffer } from "node:buffer";
import type EventEmitter from "node:events";

export type SoftphoneOptions = {
  domain: string;
  outboundProxy: string;
  username: string;
  password: string;
  authorizationId: string;
  codec?: "OPUS/16000" | "OPUS/48000/2" | "PCMU/8000";
  ignoreTlsCertErrors?: boolean;
};

declare const inboundInviteBrand: unique symbol;

export type InboundInvite = {
  readonly [inboundInviteBrand]: never;
};

export type DtmfChar =
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
  | "#";

export type SoftphoneEventMap = {
  invite: [invite: InboundInvite];
  registrationError: [error: Error];
};

export type CallSessionEventMap = {
  disposed: [];
  audio: [audio: Buffer];
  dtmf: [char: DtmfChar];
};

export type OutboundCallSessionEventMap = CallSessionEventMap & {
  answered: [];
  busy: [];
};

export type StreamerEventMap = {
  finished: [];
};

type CallSessionControls = {
  readonly callId: string;

  hangup(): Promise<void>;
  sendDTMF(char: DtmfChar): void;
  sendDTMFs(chars: string, delay?: number): Promise<void>;
  streamAudio(input: Buffer): Streamer;
  transfer(transferTo: string): Promise<void>;
  hold(): Promise<void>;
  unhold(): Promise<void>;
};

export type CallSession = EventEmitter<CallSessionEventMap> &
  CallSessionControls;

export type OutboundCallSession = EventEmitter<OutboundCallSessionEventMap> &
  CallSessionControls & {
    readonly sessionId: string | undefined;
    readonly partyId: string | undefined;

    cancel(): Promise<void>;
  };

export type Streamer = EventEmitter<StreamerEventMap> & {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
};

/** @internal */
export type NormalizedSoftphoneOptions = SoftphoneOptions & {
  codec: NonNullable<SoftphoneOptions["codec"]>;
  ignoreTlsCertErrors: boolean;
};

const parseEndpoint = (value: string) => {
  try {
    return new URL(`tls://${value}`);
  } catch {
    return undefined;
  }
};

const hasUrlExtras = (url: URL) =>
  [url.username, url.password, url.pathname, url.search, url.hash].some(
    Boolean,
  );

/** @internal */
export const normalizeSoftphoneOptions = (
  suppliedOptions: SoftphoneOptions,
): NormalizedSoftphoneOptions => {
  const options = { ...suppliedOptions };

  for (const key of [
    "domain",
    "outboundProxy",
    "username",
    "password",
    "authorizationId",
  ] as const) {
    if (typeof options[key] !== "string" || options[key].trim() === "") {
      throw new Error(`${key} must not be blank`);
    }
  }

  const domain = parseEndpoint(options.domain);
  if (!domain?.hostname || domain.port !== "" || hasUrlExtras(domain)) {
    throw new Error("domain must be a hostname without a port");
  }

  const outboundProxy = parseEndpoint(options.outboundProxy);
  const port = Number(outboundProxy?.port);
  if (
    !outboundProxy?.hostname ||
    hasUrlExtras(outboundProxy) ||
    outboundProxy.port === "" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("outboundProxy must be a hostname and port");
  }

  return {
    ...options,
    codec: options.codec ?? "OPUS/16000",
    ignoreTlsCertErrors: options.ignoreTlsCertErrors ?? false,
  };
};
