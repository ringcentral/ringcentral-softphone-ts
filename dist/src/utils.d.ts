import type SipInfoResponse from '@rc-ex/core/lib/definitions/SipInfoResponse';
export declare const generateAuthorization: (sipInfo: SipInfoResponse, nonce: string, method: "REGISTER" | "INVITE") => string;
export declare const uuid: () => `${string}-${string}-${string}-${string}-${string}`;
export declare const branch: () => string;
export declare const randomInt: () => number;
export declare const withoutTag: (s: string) => string;
export declare const extractAddress: (s: string) => string;
