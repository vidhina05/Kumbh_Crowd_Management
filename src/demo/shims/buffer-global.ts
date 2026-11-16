import { Buffer } from "buffer";
// buffer@6 has no "base64url"; add it so server code using it runs unchanged in the browser.
type Enc = string | undefined;
const B = Buffer as unknown as { from: (...a: unknown[]) => Buffer; isEncoding: (e: string) => boolean; byteLength: (...a: unknown[]) => number };
const origFrom = B.from.bind(Buffer);
B.from = (v: unknown, enc?: unknown, len?: unknown) => {
  if (typeof v === "string" && enc === "base64url") {
    let s = v.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return origFrom(s, "base64");
  }
  return origFrom(v, enc, len);
};
const origIsEnc = B.isEncoding.bind(Buffer);
B.isEncoding = (e: string) => e === "base64url" || origIsEnc(e);
const origLen = B.byteLength.bind(Buffer);
B.byteLength = (v: unknown, enc?: unknown) => (enc === "base64url" ? B.from(v, "base64url").length : origLen(v, enc));
const proto = Buffer.prototype as unknown as { toString: (enc?: Enc, s?: number, e?: number) => string; write: (...a: unknown[]) => number };
const origToString = proto.toString;
proto.toString = function (this: Buffer, enc?: Enc, s?: number, e?: number) {
  if (enc === "base64url") return origToString.call(this, "base64", s, e).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return origToString.call(this, enc, s, e);
};
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
export { Buffer };
