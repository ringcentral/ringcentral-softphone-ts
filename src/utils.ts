import crypto from "node:crypto";

import { SipCredentials } from "./types.js";

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

const generateResponse = (
  credentials: SipCredentials,
  endpoint: string,
  nonce: string,
) => {
  const ha1 = md5(
    `${credentials.authorizationId}:${credentials.domain}:${credentials.password}`,
  );
  const ha2 = md5(endpoint);
  const response = md5(`${ha1}:${nonce}:${ha2}`);
  return response;
};

export const generateAuthorization = (
  credentials: SipCredentials,
  nonce: string,
  method: "REGISTER" | "INVITE",
) => {
  const authObj = {
    "Digest algorithm": "MD5",
    username: credentials.authorizationId,
    realm: credentials.domain,
    nonce,
    uri: `sip:${credentials.domain}`,
    response: generateResponse(
      credentials,
      `${method}:sip:${credentials.domain}`,
      nonce,
    ),
  };
  return Object.entries(authObj)
    .map(([key, value]) => `${key}="${value}"`)
    .join(", ");
};

export const uuid = () => crypto.randomUUID();
export const branch = () => "z9hG4bK-" + uuid();

export const randomInt = () =>
  Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;

export const withoutTag = (s: string) => s.replace(/;tag=.*$/, "");
export const extractAddress = (s: string) => s.match(/<(sip:.+?)>/)?.[1];

export const generateLocalKey = () =>
  crypto.randomBytes(30).toString("base64").replace(/=+$/, "");
