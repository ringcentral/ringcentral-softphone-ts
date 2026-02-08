/**
 * SIP authentication credentials.
 */
export interface SipCredentials {
  domain: string;
  username: string;
  password: string;
  authorizationId: string;
}

/**
 * Configuration options for the Softphone.
 */
export interface SoftPhoneOptions extends SipCredentials {
  outboundProxy?: string;
  codec?: "OPUS/16000" | "OPUS/48000/2" | "PCMU/8000";
  ignoreTlsCertErrors?: boolean;
}
