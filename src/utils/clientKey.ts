type ClientCrypto = Partial<Pick<Crypto, "getRandomValues" | "randomUUID">>;

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const randomToken = (cryptoApi: ClientCrypto | null): string => {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return bytesToHex(bytes);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
};

export const createClientKey = (
  prefix: string,
  cryptoApi: ClientCrypto | null = globalThis.crypto,
): string => `${prefix}-${randomToken(cryptoApi)}`;
