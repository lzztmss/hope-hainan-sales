import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface PiiProtectorOptions {
  encryptionKey: Uint8Array;
  lookupKey: Uint8Array;
}

export interface PiiProtector {
  encryptPii(value: string): string;
  decryptPii(value: string): string;
  phoneLookupHash(value: string): string;
}

const ensureKey = (key: Uint8Array, label: string): Buffer => {
  const buffer = Buffer.from(key);
  if (buffer.byteLength !== 32) {
    throw new Error(`${label}必须为32字节`);
  }
  return buffer;
};

const decodePart = (part: string): Buffer => Buffer.from(part, "base64url");

export const normalizeMainlandPhone = (value: string): string => {
  let normalized = value.trim().replace(/[\s()-]/g, "");
  if (normalized.startsWith("+86")) normalized = normalized.slice(3);
  if (normalized.startsWith("0086")) normalized = normalized.slice(4);

  if (!/^1[3-9]\d{9}$/.test(normalized)) {
    throw new Error("手机号格式不正确");
  }
  return normalized;
};

export const maskPhone = (value: string): string => {
  const normalized = normalizeMainlandPhone(value);
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
};

export const createPiiProtector = (
  options: PiiProtectorOptions,
): PiiProtector => {
  const encryptionKey = ensureKey(options.encryptionKey, "PII_ENCRYPTION_KEY");
  const lookupKey = ensureKey(options.lookupKey, "PII_LOOKUP_KEY");

  return {
    encryptPii(value) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      cipher.setAAD(Buffer.from(ENCRYPTION_VERSION, "utf8"));
      const ciphertext = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();

      return [
        ENCRYPTION_VERSION,
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },

    decryptPii(value) {
      try {
        const [version, ivPart, tagPart, ciphertextPart, extra] = value.split(".");
        if (
          version !== ENCRYPTION_VERSION ||
          !ivPart ||
          !tagPart ||
          ciphertextPart === undefined ||
          extra !== undefined
        ) {
          throw new Error("invalid envelope");
        }

        const iv = decodePart(ivPart);
        const tag = decodePart(tagPart);
        if (iv.byteLength !== IV_BYTES || tag.byteLength !== AUTH_TAG_BYTES) {
          throw new Error("invalid envelope length");
        }

        const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv, {
          authTagLength: AUTH_TAG_BYTES,
        });
        decipher.setAAD(Buffer.from(ENCRYPTION_VERSION, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(decodePart(ciphertextPart)),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new Error("客户资料校验失败");
      }
    },

    phoneLookupHash(value) {
      return createHmac("sha256", lookupKey)
        .update(normalizeMainlandPhone(value), "utf8")
        .digest("hex");
    },
  };
};
