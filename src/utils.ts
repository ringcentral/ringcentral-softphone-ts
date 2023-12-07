import type SipInfoResponse from '@rc-ex/core/lib/definitions/SipInfoResponse';
import crypto from 'crypto';

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

// eslint-disable-next-line max-params
const generateResponse = (sipInfo: SipInfoResponse, endpoint: string, nonce: string) => {
  const ha1 = md5(`${sipInfo.authorizationId}:${sipInfo.domain}:${sipInfo.password}`);
  const ha2 = md5(endpoint);
  const response = md5(`${ha1}:${nonce}:${ha2}`);
  return response;
};

export const generateAuthorization = (sipInfo: SipInfoResponse, nonce: string) => {
  const authObj = {
    'Digest algorithm': 'MD5',
    username: sipInfo.authorizationId,
    realm: sipInfo.domain,
    nonce,
    uri: `sip:${sipInfo.domain}`,
    response: generateResponse(sipInfo, `REGISTER:sip:${sipInfo.domain}`, nonce),
  };
  return Object.keys(authObj)
    .map((key) => `${key}="${authObj[key]}"`)
    .join(', ');
};

export const generateProxyAuthorization = (sipInfo: SipInfoResponse, nonce: string, callee: number) => {
  const authObj = {
    'Digest algorithm': 'MD5',
    username: sipInfo.authorizationId,
    realm: sipInfo.domain,
    nonce,
    uri: `${callee}@sip:${sipInfo.domain}`,
    response: generateResponse(sipInfo, `INVITE:${callee}@sip:${sipInfo.domain}`, nonce),
  };
  return Object.keys(authObj)
    .map((key) => `${key}="${authObj[key]}"`)
    .join(', ');
};

export const uuid = () => crypto.randomUUID();
