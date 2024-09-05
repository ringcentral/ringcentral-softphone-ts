"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractAddress = exports.withoutTag = exports.randomInt = exports.branch = exports.uuid = exports.generateAuthorization = void 0;
const crypto_1 = __importDefault(require("crypto"));
const md5 = (s) => crypto_1.default.createHash('md5').update(s).digest('hex');
const generateResponse = (sipInfo, endpoint, nonce) => {
    const ha1 = md5(`${sipInfo.authorizationId}:${sipInfo.domain}:${sipInfo.password}`);
    const ha2 = md5(endpoint);
    const response = md5(`${ha1}:${nonce}:${ha2}`);
    return response;
};
const generateAuthorization = (sipInfo, nonce, method) => {
    const authObj = {
        'Digest algorithm': 'MD5',
        username: sipInfo.authorizationId,
        realm: sipInfo.domain,
        nonce,
        uri: `sip:${sipInfo.domain}`,
        response: generateResponse(sipInfo, `${method}:sip:${sipInfo.domain}`, nonce),
    };
    return Object.keys(authObj)
        .map((key) => `${key}="${authObj[key]}"`)
        .join(', ');
};
exports.generateAuthorization = generateAuthorization;
const uuid = () => crypto_1.default.randomUUID();
exports.uuid = uuid;
const branch = () => 'z9hG4bK-' + (0, exports.uuid)();
exports.branch = branch;
const randomInt = () => Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;
exports.randomInt = randomInt;
const withoutTag = (s) => s.replace(/;tag=.*$/, '');
exports.withoutTag = withoutTag;
const extractAddress = (s) => s.match(/<(sip:.+?)>/)[1];
exports.extractAddress = extractAddress;
//# sourceMappingURL=utils.js.map