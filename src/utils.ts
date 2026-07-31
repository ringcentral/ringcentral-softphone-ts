import crypto from "node:crypto";

import type { SoftphoneOptions } from "./types.js";

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

export const generateAuthorization = (
  sipInfo: SoftphoneOptions,
  nonce: string,
  method: "REGISTER" | "INVITE",
) => {
  const ha1 = md5(
    `${sipInfo.authorizationId}:${sipInfo.domain}:${sipInfo.password}`,
  );
  const ha2 = md5(`${method}:sip:${sipInfo.domain}`);
  return [
    'Digest algorithm="MD5"',
    `username="${sipInfo.authorizationId}"`,
    `realm="${sipInfo.domain}"`,
    `nonce="${nonce}"`,
    `uri="sip:${sipInfo.domain}"`,
    `response="${md5(`${ha1}:${nonce}:${ha2}`)}"`,
  ].join(", ");
};

export const uuid = () => crypto.randomUUID();
export const branch = () => `z9hG4bK-${uuid()}`;

export const withoutTag = (s: string) => s.replace(/;tag=.*$/, "");
export const extractAddress = (s: string) => s.match(/<(sip:.+?)>/)?.[1];

export const localKey = crypto
  .randomBytes(30)
  .toString("base64")
  .replace(/=+$/, "");
