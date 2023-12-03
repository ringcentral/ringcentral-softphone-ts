import type SipInfoResponse from '@rc-ex/core/lib/definitions/SipInfoResponse';
import crypto from 'crypto';

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

const generateResponse = (sipInfo: SipInfoResponse, method: string, nonce: string) => {
  const ha1 = md5(`${sipInfo.authorizationId}:${sipInfo.domain}:${sipInfo.password}`);
  const ha2 = md5(`${method}:sip:${sipInfo.domain}`);
  const response = md5(`${ha1}:${nonce}:${ha2}`);
  return response;
};

export const generateAuthorization = (sipInfo: SipInfoResponse, method: 'REGISTER', nonce: string) => {
  const authObj = {
    'Digest algorithm': 'MD5',
    username: sipInfo.authorizationId,
    realm: sipInfo.domain,
    nonce,
    uri: `sip:${sipInfo.domain}`,
    response: generateResponse(sipInfo, method, nonce),
  };
  return Object.keys(authObj)
    .map((key) => `${key}="${authObj[key]}"`)
    .join(', ');
};

export const uuid = () => crypto.randomUUID();
