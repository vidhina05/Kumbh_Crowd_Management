/**
 * Browser stand-in for the parts of `node:crypto` the server code uses.
 * Only bundled into the in-browser demo backend (see scripts/build-pages.mjs); the real server uses Node's crypto.
 * Algorithms are the same (AES-256-GCM, HMAC-SHA256, SHA-256), implemented with the audited @noble libraries.
 */
import { Buffer } from "buffer";
import { gcm } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

type Data = string | Uint8Array;
const bytes = (d: Data): Uint8Array => (typeof d === "string" ? new TextEncoder().encode(d) : d);
const out = (b: Uint8Array, enc?: string) => {
  const buf = Buffer.from(b);
  return enc ? buf.toString(enc as BufferEncoding) : buf;
};

export function randomBytes(n: number): Buffer {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}

export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) throw new RangeError("max must be a positive integer");
  const limit = Math.floor(0x100000000 / max) * max;
  const u = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(u);
    if (u[0] < limit) return u[0] % max;
  }
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

class Hash {
  private parts: Uint8Array[] = [];
  constructor(private key?: Uint8Array) {}
  update(d: Data) {
    this.parts.push(bytes(d));
    return this;
  }
  digest(enc?: string) {
    const all = Buffer.concat(this.parts.map((p) => Buffer.from(p)));
    return out(this.key ? hmac(sha256, this.key, all) : sha256(all), enc);
  }
}

export function createHash(alg: string) {
  if (alg !== "sha256") throw new Error(`Unsupported hash ${alg}`);
  return new Hash();
}

export function createHmac(alg: string, key: Data) {
  if (alg !== "sha256") throw new Error(`Unsupported hmac ${alg}`);
  return new Hash(bytes(key));
}

class Gcm {
  private parts: Uint8Array[] = [];
  private tag: Uint8Array | null = null;
  constructor(private key: Uint8Array, private iv: Uint8Array, private decrypting: boolean) {}
  update(d: Data) {
    this.parts.push(bytes(d));
    return Buffer.alloc(0);
  }
  setAuthTag(t: Uint8Array) {
    this.tag = t;
    return this;
  }
  final() {
    const data = Buffer.concat(this.parts.map((p) => Buffer.from(p)));
    const c = gcm(this.key, this.iv);
    if (this.decrypting) {
      if (!this.tag) throw new Error("Auth tag missing");
      return Buffer.from(c.decrypt(Buffer.concat([data, Buffer.from(this.tag)])));
    }
    const sealed = c.encrypt(data);
    this.tag = sealed.slice(sealed.length - 16);
    return Buffer.from(sealed.slice(0, sealed.length - 16));
  }
  getAuthTag() {
    if (!this.tag) throw new Error("Call final() first");
    return Buffer.from(this.tag);
  }
}

export function createCipheriv(alg: string, key: Uint8Array, iv: Uint8Array) {
  if (alg !== "aes-256-gcm") throw new Error(`Unsupported cipher ${alg}`);
  return new Gcm(key, iv, false);
}

export function createDecipheriv(alg: string, key: Uint8Array, iv: Uint8Array) {
  if (alg !== "aes-256-gcm") throw new Error(`Unsupported cipher ${alg}`);
  return new Gcm(key, iv, true);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError("Input buffers must have the same byte length");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const webcrypto = globalThis.crypto;
export default { randomBytes, randomInt, randomUUID, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual, webcrypto };
