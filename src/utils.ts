import crypto from "node:crypto";

import { SoftPhoneOptions } from "./types.js";

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

const generateResponse = (
  sipInfo: SoftPhoneOptions,
  endpoint: string,
  nonce: string,
) => {
  const ha1 = md5(
    `${sipInfo.authorizationId}:${sipInfo.domain}:${sipInfo.password}`,
  );
  const ha2 = md5(endpoint);
  const response = md5(`${ha1}:${nonce}:${ha2}`);
  return response;
};

export const generateAuthorization = (
  sipInfo: SoftPhoneOptions,
  nonce: string,
  method: "REGISTER" | "INVITE",
) => {
  const authObj = {
    "Digest algorithm": "MD5",
    username: sipInfo.authorizationId,
    realm: sipInfo.domain,
    nonce,
    uri: `sip:${sipInfo.domain}`,
    response: generateResponse(
      sipInfo,
      `${method}:sip:${sipInfo.domain}`,
      nonce,
    ),
  };
  return Object.keys(authObj)
    .map((key) => `${key}="${authObj[key]}"`)
    .join(", ");
};

export const uuid = () => crypto.randomUUID();
export const branch = () => "z9hG4bK-" + uuid();

export const randomInt = () =>
  Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;

export const withoutTag = (s: string) => s.replace(/;tag=.*$/, "");
export const extractAddress = (s: string) => s.match(/<(sip:.+?)>/)?.[1];

const keyAndSalt = crypto.randomBytes(30);
export const localKey = keyAndSalt.toString("base64").replace(/=+$/, "");
