import crypto from 'crypto';
import { createServer } from 'net';

import type SipInfoResponse from '@rc-ex/core/lib/definitions/SipInfoResponse';

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

const generateResponse = (
  sipInfo: SipInfoResponse,
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
  sipInfo: SipInfoResponse,
  nonce: string,
  method: 'REGISTER' | 'INVITE',
) => {
  const authObj = {
    'Digest algorithm': 'MD5',
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
    .join(', ');
};

export const uuid = () => crypto.randomUUID();
export const branch = () => 'z9hG4bK-' + uuid();

export const randomInt = () =>
  Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;

export const withoutTag = (s: string) => s.replace(/;tag=.*$/, '');
export const extractAddress = (s: string) => s.match(/<(sip:.+?)>/)[1];

const keyAndSalt = crypto.randomBytes(30);
export const localKey = keyAndSalt.toString('base64').replace(/=+$/, '');

export const getRandomAvailablePort = async (): Promise<number> => {
  const randomPort = Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(randomPort, () => {
      server.close(() => {
        resolve(randomPort);
      });
    });
    server.on('error', () => {
      resolve(getRandomAvailablePort());
    });
  });
};
