import { createCipheriv, createHmac } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  aesCm,
  deriveSessionKeys,
  parseRtp,
  type RtpHeader,
  type RtpPacket,
  SrtpSession,
  serializeRtp,
} from "../src/rtp/index.js";

const key = Buffer.from(Array.from({ length: 30 }, (_, index) => index));
const otherKey = Buffer.from(
  Array.from({ length: 30 }, (_, index) => 30 + index),
);

const packet = (
  sequenceNumber: number,
  ssrc = 0x11223344,
  payload = Buffer.from("payload"),
): RtpPacket => ({
  header: {
    marker: false,
    payloadType: 0,
    sequenceNumber,
    timestamp: sequenceNumber * 160,
    ssrc,
  },
  payload,
});

const sessions = () => ({
  receiver: new SrtpSession(otherKey, key),
  sender: new SrtpSession(key, otherKey),
});

const protectRawRtp = (
  plaintext: Buffer,
  payloadOffset: number,
  keyMaterial: Buffer,
) => {
  const parsed = parseRtp(plaintext)!;
  const keys = deriveSessionKeys(keyMaterial);
  const counter = Buffer.alloc(16);
  counter.writeUInt32BE(parsed.header.ssrc, 4);
  counter.writeUInt32BE(parsed.header.sequenceNumber * 65536, 12);
  for (let index = 0; index < keys.salt.length; index++) {
    counter[index] ^= keys.salt[index];
  }
  const cipher = createCipheriv("aes-128-ctr", keys.encryption, counter);
  const encrypted = Buffer.concat([
    plaintext.subarray(0, payloadOffset),
    cipher.update(plaintext.subarray(payloadOffset)),
    cipher.final(),
  ]);
  const roc = Buffer.alloc(4);
  const tag = createHmac("sha1", keys.authentication)
    .update(encrypted)
    .update(roc)
    .digest()
    .subarray(0, 10);
  return Buffer.concat([encrypted, tag]);
};

describe("RTP", () => {
  test("serializes and parses the fixed RTP header", () => {
    const value: RtpPacket = {
      header: {
        marker: true,
        payloadType: 96,
        sequenceNumber: 0xabcd,
        timestamp: 0x01020304,
        ssrc: 0x11223344,
      },
      payload: Buffer.from("deadbeef", "hex"),
    };

    const serialized = serializeRtp(value);

    expect(serialized.toString("hex")).toBe("80e0abcd0102030411223344deadbeef");
    expect(parseRtp(serialized)).toEqual(value);
  });

  test("skips CSRCs and extensions and removes padding", () => {
    const serialized = Buffer.from(
      "b2e004d20102030411223344" +
        "0101010102020202" +
        "bede00021122334455667788" +
        "deadbeef00000004",
      "hex",
    );

    expect(parseRtp(serialized)).toEqual({
      header: {
        marker: true,
        payloadType: 96,
        sequenceNumber: 1234,
        timestamp: 0x01020304,
        ssrc: 0x11223344,
      },
      payload: Buffer.from("deadbeef", "hex"),
    });
  });

  test.each([
    Buffer.alloc(11),
    Buffer.from("40e000000000000000000000", "hex"),
    Buffer.from("82e000000000000000000000", "hex"),
    Buffer.from("90e000000000000000000000", "hex"),
    Buffer.from("90e000000000000000000000bede0001", "hex"),
    Buffer.from("a0e00000000000000000000000", "hex"),
    Buffer.from("a0e0000000000000000000000003", "hex"),
  ])("rejects malformed RTP", (serialized) => {
    expect(parseRtp(serialized)).toBeUndefined();
  });
});

describe("SRTP", () => {
  test("matches the RFC 3711 AES-CM keystream", () => {
    expect(
      aesCm(
        Buffer.alloc(32),
        packet(0, 0).header,
        0,
        Buffer.from("2b7e151628aed2a6abf7158809cf4f3c", "hex"),
        Buffer.from("f0f1f2f3f4f5f6f7f8f9fafbfcfd", "hex"),
      ).toString("hex"),
    ).toBe("e03ead0935c95e80e166b16dd92b4eb4d23513162b02d0f72a43a2fe4a5f97ab");
  });

  test("derives the RFC 3711 session keys", () => {
    const keys = deriveSessionKeys(
      Buffer.from(
        "e1f97a0d3e018be0d64fa32c06de4139" + "0ec675ad498afeebb6960b3aabe6",
        "hex",
      ),
    );

    expect(keys.encryption.toString("hex")).toBe(
      "c61e7a93744f39ee10734afe3ff7a087",
    );
    expect(keys.authentication.toString("hex")).toBe(
      "cebe321f6ff7716b6fd4ab49af256a156d38baa4",
    );
    expect(keys.salt.toString("hex")).toBe("30cbbc08863d8c85d49db34a9ae1");
  });

  test("matches frozen Werift audio and DTMF packets", () => {
    const session = new SrtpSession(key, key);
    const audioHeader: RtpHeader = {
      marker: true,
      payloadType: 0,
      sequenceNumber: 65535,
      timestamp: 0x01020304,
      ssrc: 0x11223344,
    };

    expect(
      session
        .encrypt(
          Buffer.from("00112233445566778899aabbccddeeff", "hex"),
          audioHeader,
        )
        .toString("hex"),
    ).toBe(
      "8080ffff01020304112233442919148846a59062b39491edae91cae374b64a3b6d97d2deb8c1",
    );

    const dtmfHeader: RtpHeader = {
      marker: true,
      payloadType: 101,
      sequenceNumber: 42,
      timestamp: 1234,
      ssrc: 5678,
    };
    expect(
      session
        .encrypt(Buffer.from("058a00a0", "hex"), dtmfHeader)
        .toString("hex"),
    ).toBe("80e5002a000004d20000162e15f12416619ed209fc6d611eb783");

    dtmfHeader.marker = false;
    dtmfHeader.sequenceNumber = 47;
    expect(
      session
        .encrypt(Buffer.from("058a0320", "hex"), dtmfHeader)
        .toString("hex"),
    ).toBe("8065002f000004d20000162ef26558139a14afdc0dffb61c9ac3");
  });

  test("decrypts authenticated RTP with CSRCs, extensions, and padding", () => {
    const plaintext = Buffer.from(
      "b2e004d20102030411223344" +
        "0101010102020202" +
        "bede00021122334455667788" +
        "deadbeef00000004",
      "hex",
    );
    const receiver = new SrtpSession(otherKey, key);

    expect(receiver.decrypt(protectRawRtp(plaintext, 32, key))).toEqual(
      parseRtp(plaintext),
    );
  });

  test.each([
    { name: "authentication tag", byte: -1 },
    { name: "encrypted payload", byte: 12 },
    { name: "RTP header", byte: 4 },
  ])("rejects $name tampering", ({ byte }) => {
    const { receiver, sender } = sessions();
    const encrypted = sender.encrypt(packet(1).payload, packet(1).header);
    encrypted[byte < 0 ? encrypted.length + byte : byte] ^= 1;

    expect(receiver.decrypt(encrypted)).toBeUndefined();
  });

  test("rejects replayed packets and accepts out-of-order packets once", () => {
    const { receiver, sender } = sessions();
    const encrypted = [10, 12, 11].map((sequenceNumber) => {
      const value = packet(sequenceNumber);
      return sender.encrypt(value.payload, value.header);
    });

    expect(receiver.decrypt(encrypted[0])?.header.sequenceNumber).toBe(10);
    expect(receiver.decrypt(encrypted[1])?.header.sequenceNumber).toBe(12);
    expect(receiver.decrypt(encrypted[2])?.header.sequenceNumber).toBe(11);
    expect(receiver.decrypt(encrypted[2])).toBeUndefined();
  });

  test("rejects packets outside the 64-packet replay window", () => {
    const { receiver, sender } = sessions();
    const old = packet(1);
    const newest = packet(65);
    const encryptedOld = sender.encrypt(old.payload, old.header);
    const encryptedNewest = sender.encrypt(newest.payload, newest.header);

    expect(receiver.decrypt(encryptedNewest)).toBeDefined();
    expect(receiver.decrypt(encryptedOld)).toBeUndefined();
  });

  test("tracks sequence rollover per SSRC", () => {
    const { receiver, sender } = sessions();
    for (const sequenceNumber of [65535, 0]) {
      const value = packet(sequenceNumber);
      expect(
        receiver.decrypt(sender.encrypt(value.payload, value.header))?.header
          .sequenceNumber,
      ).toBe(sequenceNumber);
    }
  });

  test("does not update receive state after authentication failure", () => {
    const { receiver, sender } = sessions();
    const beforeRollover = packet(65535);
    const afterRollover = packet(0);
    const first = sender.encrypt(beforeRollover.payload, beforeRollover.header);
    const second = sender.encrypt(afterRollover.payload, afterRollover.header);
    const tampered = Buffer.from(second);
    tampered[tampered.length - 1] ^= 1;

    expect(receiver.decrypt(first)).toBeDefined();
    expect(receiver.decrypt(tampered)).toBeUndefined();
    expect(receiver.decrypt(second)).toEqual(afterRollover);
  });

  test("tracks replay state independently for each SSRC", () => {
    const { receiver, sender } = sessions();
    const first = packet(7, 1);
    const second = packet(7, 2);
    const encryptedFirst = sender.encrypt(first.payload, first.header);
    const encryptedSecond = sender.encrypt(second.payload, second.header);

    expect(receiver.decrypt(encryptedFirst)).toEqual(first);
    expect(receiver.decrypt(encryptedSecond)).toEqual(second);
    expect(receiver.decrypt(encryptedFirst)).toBeUndefined();
    expect(receiver.decrypt(encryptedSecond)).toBeUndefined();
  });

  test("rejects invalid keys and malformed secure packets", () => {
    expect(() => new SrtpSession(Buffer.alloc(29), key)).toThrow(
      "SRTP key material must be 30 bytes",
    );
    const receiver = new SrtpSession(key, key);
    expect(receiver.decrypt(Buffer.alloc(21))).toBeUndefined();
    expect(receiver.decrypt(Buffer.alloc(22))).toBeUndefined();
  });
});
