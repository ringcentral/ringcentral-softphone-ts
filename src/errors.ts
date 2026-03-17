/**
 * Base error class for all softphone-related errors.
 */
export class SoftphoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoftphoneError";
  }
}

/**
 * Error thrown when SIP message parsing fails.
 */
export class SipParseError extends SoftphoneError {
  constructor(message: string) {
    super(message);
    this.name = "SipParseError";
  }
}

/**
 * Error thrown when SIP authentication fails.
 */
export class SipAuthError extends SoftphoneError {
  constructor(message: string) {
    super(message);
    this.name = "SipAuthError";
  }
}

/**
 * Error thrown when SIP registration fails.
 */
export class SipRegistrationError extends SoftphoneError {
  constructor(message: string) {
    super(message);
    this.name = "SipRegistrationError";
  }
}

/**
 * Error thrown when a call operation fails.
 */
export class CallError extends SoftphoneError {
  constructor(message: string) {
    super(message);
    this.name = "CallError";
  }
}

/**
 * Error thrown when SDP parsing fails.
 */
export class SdpParseError extends SoftphoneError {
  constructor(message: string) {
    super(message);
    this.name = "SdpParseError";
  }
}

/**
 * Error thrown when connection times out or fails.
 */
export class ConnectionError extends SoftphoneError {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}
