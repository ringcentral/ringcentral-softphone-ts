import { DTMF_PAYLOAD_TYPE } from "../constants.js";
import { SdpParseError } from "../errors/index.js";
import { localKey, randomInt } from "../utils.js";

export interface SdpConfig {
  localAddress: string;
  codecId: number;
  codecName: string;
}

/**
 * Builds SDP (Session Description Protocol) payloads for SIP messaging.
 */
export class SdpBuilder {
  /**
   * Creates an SDP offer/answer for audio communication.
   */
  static create(config: SdpConfig): string {
    const { localAddress, codecId, codecName } = config;
    return `
v=0
o=- ${Date.now()} 0 IN IP4 ${localAddress}
s=rc-softphone-ts
c=IN IP4 ${localAddress}
t=0 0
m=audio ${randomInt()} RTP/SAVP ${codecId} ${DTMF_PAYLOAD_TYPE}
a=rtpmap:${codecId} ${codecName}
a=rtpmap:${DTMF_PAYLOAD_TYPE} telephone-event/8000
a=fmtp:${DTMF_PAYLOAD_TYPE} 0-15
a=sendrecv
a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${localKey}
`.trim();
  }
}

export interface ParsedSdp {
  ip: string;
  port: number;
  srtpKey: string;
}

/**
 * Parses SDP (Session Description Protocol) payloads to extract connection info.
 */
export class SdpParser {
  /**
   * Extracts the IP address from the connection line (c=IN IP4 ...).
   * @throws SdpParseError if connection line is missing or malformed
   */
  static extractIP(sdp: string, context = "SDP"): string {
    const match = sdp.match(/c=IN IP4 ([\d.]+)/);
    if (!match) {
      throw new SdpParseError(
        `${context}: missing connection line (c=IN IP4) in SDP body`,
      );
    }
    return match[1];
  }

  /**
   * Extracts the audio port from the media line (m=audio ...).
   * @throws SdpParseError if media line is missing or malformed
   */
  static extractPort(sdp: string, context = "SDP"): number {
    const match = sdp.match(/m=audio (\d+) /);
    if (!match) {
      throw new SdpParseError(
        `${context}: missing media line (m=audio) in SDP body`,
      );
    }
    return parseInt(match[1], 10);
  }

  /**
   * Extracts the SRTP key from the crypto line.
   * @throws SdpParseError if crypto line is missing or malformed
   */
  static extractSrtpKey(sdp: string, context = "SDP"): string {
    const match = sdp.match(/AES_CM_128_HMAC_SHA1_80 inline:([\w+/]+)/);
    if (!match) {
      throw new SdpParseError(
        `${context}: missing SRTP key (AES_CM_128_HMAC_SHA1_80) in SDP body`,
      );
    }
    return match[1];
  }

  /**
   * Parses all connection information from an SDP body.
   * @throws SdpParseError if any required field is missing
   */
  static parse(sdp: string, context = "SDP"): ParsedSdp {
    return {
      ip: SdpParser.extractIP(sdp, context),
      port: SdpParser.extractPort(sdp, context),
      srtpKey: SdpParser.extractSrtpKey(sdp, context),
    };
  }
}
