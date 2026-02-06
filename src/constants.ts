// SIP Protocol Constants
export const SIP_REGISTRATION_EXPIRES_SECONDS = 3600;
export const SIP_SESSION_EXPIRES_SECONDS = 1800;

// RTP Constants
export const RTP_SEQUENCE_NUMBER_MAX = 65536; // 16-bit wraparound
export const RTP_EXTENSION_PROFILE = 48862;
export const DTMF_PAYLOAD_TYPE = 101;
export const SRTP_PROFILE_AES_CM_128_HMAC_SHA1_80 = 0x0001;

// DTMF Timing
export const DTMF_TIMESTAMP_INCREMENT = 800;
export const DTMF_DEFAULT_DELAY_MS = 500;

// Audio Streaming
export const AUDIO_PACKET_INTERVAL_MS = 20;
