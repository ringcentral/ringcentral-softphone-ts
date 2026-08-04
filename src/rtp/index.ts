import { createCipheriv, createHmac, timingSafeEqual } from "node:crypto";

const AUTH_TAG_LENGTH = 10;
const REPLAY_WINDOW = 64;
const REPLAY_MASK = (1n << BigInt(REPLAY_WINDOW)) - 1n;

export type RtpHeader = {
  marker: boolean;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
};

export type RtpPacket = {
  header: RtpHeader;
  payload: Buffer;
};

type ParsedHeader = {
  header: RtpHeader;
  payloadOffset: number;
  padding: boolean;
};

type SessionKeys = {
  encryption: Buffer;
  authentication: Buffer;
  salt: Buffer;
};

type ReceiveState = {
  highestIndex: number;
  replayWindow: bigint;
};

const aesBlock = (key: Buffer, input: Buffer) => {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(input), cipher.final()]);
};

const deriveKey = (
  masterKey: Buffer,
  masterSalt: Buffer,
  label: number,
  length: number,
) => {
  const input = Buffer.alloc(16);
  masterSalt.copy(input);
  input[7] ^= label;

  const output: Buffer[] = [];
  for (let block = 0; block * 16 < length; block++) {
    input.writeUInt16BE(block, 14);
    output.push(aesBlock(masterKey, input));
  }
  return Buffer.concat(output).subarray(0, length);
};

export const deriveSessionKeys = (keyMaterial: Buffer): SessionKeys => {
  if (keyMaterial.length !== 30) {
    throw new Error("SRTP key material must be 30 bytes");
  }
  const masterKey = keyMaterial.subarray(0, 16);
  const masterSalt = keyMaterial.subarray(16);
  return {
    encryption: deriveKey(masterKey, masterSalt, 0, 16),
    authentication: deriveKey(masterKey, masterSalt, 1, 20),
    salt: deriveKey(masterKey, masterSalt, 2, 14),
  };
};

const parseHeader = (packet: Buffer): ParsedHeader | undefined => {
  if (packet.length < 12 || packet[0] >> 6 !== 2) {
    return;
  }

  const firstByte = packet[0];
  let payloadOffset = 12 + (firstByte & 0x0f) * 4;
  if (payloadOffset > packet.length) {
    return;
  }
  if (firstByte & 0x10) {
    if (payloadOffset + 4 > packet.length) {
      return;
    }
    payloadOffset += 4 + packet.readUInt16BE(payloadOffset + 2) * 4;
    if (payloadOffset > packet.length) {
      return;
    }
  }

  return {
    header: {
      marker: (packet[1] & 0x80) !== 0,
      payloadType: packet[1] & 0x7f,
      sequenceNumber: packet.readUInt16BE(2),
      timestamp: packet.readUInt32BE(4),
      ssrc: packet.readUInt32BE(8),
    },
    payloadOffset,
    padding: (firstByte & 0x20) !== 0,
  };
};

export const serializeRtp = ({ header, payload }: RtpPacket) => {
  const output = Buffer.alloc(12 + payload.length);
  output[0] = 0x80;
  output[1] = (header.marker ? 0x80 : 0) | header.payloadType;
  output.writeUInt16BE(header.sequenceNumber, 2);
  output.writeUInt32BE(header.timestamp, 4);
  output.writeUInt32BE(header.ssrc, 8);
  payload.copy(output, 12);
  return output;
};

export const parseRtp = (packet: Buffer): RtpPacket | undefined => {
  const parsed = parseHeader(packet);
  if (!parsed) {
    return;
  }

  let payloadEnd = packet.length;
  if (parsed.padding) {
    const paddingLength = packet.at(-1) ?? 0;
    if (
      paddingLength === 0 ||
      paddingLength > payloadEnd - parsed.payloadOffset
    ) {
      return;
    }
    payloadEnd -= paddingLength;
  }
  return {
    header: parsed.header,
    payload: packet.subarray(parsed.payloadOffset, payloadEnd),
  };
};

const estimateIndex = (sequenceNumber: number, highestIndex: number) => {
  const highestSequence = highestIndex % 65536;
  let rolloverCounter = Math.floor(highestIndex / 65536);
  if (highestSequence < 32768 && sequenceNumber - highestSequence > 32768) {
    rolloverCounter--;
  } else if (
    highestSequence >= 32768 &&
    highestSequence - sequenceNumber > 32768
  ) {
    rolloverCounter++;
  }
  return rolloverCounter < 0
    ? undefined
    : rolloverCounter * 65536 + sequenceNumber;
};

const counter = (header: RtpHeader, rolloverCounter: number, salt: Buffer) => {
  const value = Buffer.alloc(16);
  value.writeUInt32BE(header.ssrc, 4);
  value.writeUInt32BE(rolloverCounter, 8);
  value.writeUInt32BE(header.sequenceNumber * 65536, 12);
  for (let index = 0; index < salt.length; index++) {
    value[index] ^= salt[index];
  }
  return value;
};

export const aesCm = (
  payload: Buffer,
  header: RtpHeader,
  rolloverCounter: number,
  key: Buffer,
  salt: Buffer,
) => {
  const cipher = createCipheriv(
    "aes-128-ctr",
    key,
    counter(header, rolloverCounter, salt),
  );
  return Buffer.concat([cipher.update(payload), cipher.final()]);
};

const authenticate = (packet: Buffer, rolloverCounter: number, key: Buffer) => {
  const roc = Buffer.alloc(4);
  roc.writeUInt32BE(rolloverCounter);
  return createHmac("sha1", key)
    .update(packet)
    .update(roc)
    .digest()
    .subarray(0, AUTH_TAG_LENGTH);
};

export class SrtpSession {
  private outboundKeys: SessionKeys;
  private inboundKeys: SessionKeys;
  private outboundIndexes = new Map<number, number>();
  private inboundStates = new Map<number, ReceiveState>();

  public constructor(localKey: Buffer, remoteKey: Buffer) {
    this.outboundKeys = deriveSessionKeys(localKey);
    this.inboundKeys = deriveSessionKeys(remoteKey);
  }

  public encrypt(payload: Buffer, header: RtpHeader) {
    const previousIndex = this.outboundIndexes.get(header.ssrc);
    const packetIndex =
      previousIndex === undefined
        ? header.sequenceNumber
        : estimateIndex(header.sequenceNumber, previousIndex);
    if (packetIndex === undefined) {
      throw new Error("RTP sequence number predates the outbound stream");
    }
    if (previousIndex === undefined || packetIndex > previousIndex) {
      this.outboundIndexes.set(header.ssrc, packetIndex);
    }

    const rolloverCounter = Math.floor(packetIndex / 65536);
    const encrypted = serializeRtp({
      header,
      payload: aesCm(
        payload,
        header,
        rolloverCounter,
        this.outboundKeys.encryption,
        this.outboundKeys.salt,
      ),
    });
    return Buffer.concat([
      encrypted,
      authenticate(
        encrypted,
        rolloverCounter,
        this.outboundKeys.authentication,
      ),
    ]);
  }

  public decrypt(encrypted: Buffer): RtpPacket | undefined {
    try {
      if (encrypted.length < 12 + AUTH_TAG_LENGTH) {
        return;
      }
      const body = encrypted.subarray(0, -AUTH_TAG_LENGTH);
      const parsed = parseHeader(body);
      if (!parsed) {
        return;
      }

      const state = this.inboundStates.get(parsed.header.ssrc);
      const packetIndex =
        state === undefined
          ? parsed.header.sequenceNumber
          : estimateIndex(parsed.header.sequenceNumber, state.highestIndex);
      if (packetIndex === undefined) {
        return;
      }
      const rolloverCounter = Math.floor(packetIndex / 65536);
      const expectedTag = authenticate(
        body,
        rolloverCounter,
        this.inboundKeys.authentication,
      );
      if (!timingSafeEqual(expectedTag, encrypted.subarray(-AUTH_TAG_LENGTH))) {
        return;
      }

      if (state && packetIndex <= state.highestIndex) {
        const age = state.highestIndex - packetIndex;
        if (
          age >= REPLAY_WINDOW ||
          (state.replayWindow & (1n << BigInt(age))) !== 0n
        ) {
          return;
        }
      }

      const payload = aesCm(
        body.subarray(parsed.payloadOffset),
        parsed.header,
        rolloverCounter,
        this.inboundKeys.encryption,
        this.inboundKeys.salt,
      );
      const packet = parseRtp(
        Buffer.concat([body.subarray(0, parsed.payloadOffset), payload]),
      );
      if (!packet) {
        return;
      }

      if (!state) {
        this.inboundStates.set(parsed.header.ssrc, {
          highestIndex: packetIndex,
          replayWindow: 1n,
        });
      } else if (packetIndex > state.highestIndex) {
        const shift = Math.min(packetIndex - state.highestIndex, REPLAY_WINDOW);
        state.replayWindow =
          ((state.replayWindow << BigInt(shift)) | 1n) & REPLAY_MASK;
        state.highestIndex = packetIndex;
      } else {
        state.replayWindow |= 1n << BigInt(state.highestIndex - packetIndex);
      }
      return packet;
    } catch {
      return;
    }
  }
}
