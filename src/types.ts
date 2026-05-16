export type SoftPhoneOptions = {
  domain: string;
  outboundProxy: string;
  username: string;
  password: string;
  authorizationId: string;
  codec?: "OPUS/16000" | "OPUS/48000/2" | "PCMU/8000";
  ignoreTlsCertErrors?: boolean;
};
