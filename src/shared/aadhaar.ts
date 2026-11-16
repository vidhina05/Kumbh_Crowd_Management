/**
 * Aadhaar Secure QR (UIDAI, 2019+): the QR on every Aadhaar letter, e-Aadhaar and PVC card.
 *
 * Format (UIDAI "Secure QR Code Specification"):
 *  - The QR text is one very large decimal number. As bytes (big-endian) it is GZIP-compressed data.
 *  - Decompressed: fields separated by byte 255, ending with a 256-byte RSA-2048 signature
 *    (SHA-256, PKCS#1 v1.5) over everything before it, made with UIDAI's private key.
 *  - Field order: [version "V2"/"V3" (newer cards only)], email/mobile indicator, reference id
 *    (last 4 digits of Aadhaar + timestamp), name, date of birth, gender, care of, district, landmark,
 *    house, location, pin code, post office, state, street, sub-district, VTC, [V3: last 4 of mobile],
 *    then the photo (JPEG 2000) and optional email/mobile hashes.
 *
 * We keep only what registration needs (name, age, gender, last 4 digits). The address and the photo
 * are never stored. The full Aadhaar number is NOT in the QR, and we never ask for it.
 *
 * Works in browsers and in Node 20+ (both have DecompressionStream and Web Crypto).
 */
export type AadhaarQr = {
  version: "V1" | "V2" | "V3";
  referenceId: string;
  last4: string;
  name: string;
  dob: string; // as printed: DD-MM-YYYY, or YYYY for year-only
  yearOfBirth: number | null;
  gender: "M" | "F" | "T" | null;
  state: string;
  district: string;
  pincode: string;
  signedBytes: Uint8Array;
  signature: Uint8Array;
};

export class AadhaarQrError extends Error {
  constructor(public code: "not_secure_qr" | "corrupt" | "old_format", message: string) {
    super(message);
  }
}

export function decimalToBytes(text: string): Uint8Array {
  const digits = text.trim();
  if (!/^\d{200,10000}$/.test(digits)) throw new AadhaarQrError("not_secure_qr", "This is not an Aadhaar Secure QR code.");
  let n = BigInt(digits);
  const out: number[] = [];
  while (n > 0n) {
    out.push(Number(n & 255n));
    n >>= 8n;
  }
  return new Uint8Array(out.reverse());
}

export function bytesToDecimal(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n.toString(10);
}

async function streamThrough(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

export const gunzip = (d: Uint8Array) => streamThrough(d, new DecompressionStream("gzip"));
export const gzip = (d: Uint8Array) => streamThrough(d, new CompressionStream("gzip"));

const latin = new TextDecoder("iso-8859-1");

export async function parseAadhaarQr(text: string): Promise<AadhaarQr> {
  if (text.trim().startsWith("<?xml") || text.includes("PrintLetterBarcodeData")) {
    throw new AadhaarQrError("old_format", "This is an old, unsigned Aadhaar QR. Please use a card printed after 2019, or your phone number.");
  }
  const packed = decimalToBytes(text);
  let data: Uint8Array;
  try {
    data = await gunzip(packed);
  } catch {
    throw new AadhaarQrError("corrupt", "The QR code could not be read. Hold the card flat and try again.");
  }
  if (data.length < 300) throw new AadhaarQrError("corrupt", "The QR code is incomplete.");
  const signature = data.slice(data.length - 256);
  const signedBytes = data.slice(0, data.length - 256);

  // Split the text part on byte 255. Text fields come first; stop before binary data (photo).
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < signedBytes.length && fields.length < 18; i++) {
    if (signedBytes[i] === 255) {
      fields.push(latin.decode(signedBytes.slice(start, i)));
      start = i + 1;
    }
  }
  let version: AadhaarQr["version"] = "V1";
  if (fields[0] === "V2" || fields[0] === "V3") {
    version = fields[0];
    fields.shift();
  }
  // [indicator, refId, name, dob, gender, careOf, district, landmark, house, location, pincode, postOffice, state, street, subDistrict, vtc]
  const [, refId = "", name = "", dob = "", gender = "", , district = "", , , , pincode = "", , state = ""] = fields;
  if (!/^\d{4}\d{8,17}$/.test(refId) || !name.trim()) throw new AadhaarQrError("corrupt", "The QR code could not be read. Hold the card flat and try again.");
  const year = dob.match(/(\d{4})$/)?.[1] ?? dob.match(/^(\d{4})/)?.[1] ?? null;
  return {
    version,
    referenceId: refId,
    last4: refId.slice(0, 4),
    name: name.trim(),
    dob,
    yearOfBirth: year ? Number(year) : null,
    gender: gender === "M" || gender === "F" || gender === "T" ? gender : null,
    state: state.trim(),
    district: district.trim(),
    pincode: pincode.trim(),
    signedBytes,
    signature,
  };
}

// ---------- Public-key handling (Web Crypto) ----------

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Minimal DER reader: enough to pull SubjectPublicKeyInfo out of an X.509 certificate. */
function readTlv(buf: Uint8Array, pos: number) {
  const tag = buf[pos];
  let len = buf[pos + 1];
  let hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[pos + 2 + i];
    hdr = 2 + n;
  }
  return { tag, start: pos, contentStart: pos + hdr, end: pos + hdr + len };
}

export function spkiFromCertificate(der: Uint8Array): Uint8Array {
  const cert = readTlv(der, 0); // Certificate SEQUENCE
  const tbs = readTlv(der, cert.contentStart); // tbsCertificate SEQUENCE
  let p = tbs.contentStart;
  const items: ReturnType<typeof readTlv>[] = [];
  while (p < tbs.end && items.length < 8) {
    const t = readTlv(der, p);
    items.push(t);
    p = t.end;
  }
  // [0] version (optional), serial, signature alg, issuer, validity, subject, subjectPublicKeyInfo
  const offset = items[0].tag === 0xa0 ? 1 : 0;
  const spki = items[offset + 5];
  if (!spki || spki.tag !== 0x30) throw new Error("Not an X.509 certificate");
  return der.slice(spki.start, spki.end);
}

/** Accepts a PEM public key (SPKI) or a PEM/DER certificate (.cer) as published by UIDAI. */
export async function importAadhaarKey(pemOrCert: string | Uint8Array): Promise<CryptoKey> {
  let der = typeof pemOrCert === "string" ? pemToDer(pemOrCert) : pemOrCert;
  const isCert = typeof pemOrCert === "string" ? pemOrCert.includes("CERTIFICATE") : true;
  if (isCert) der = spkiFromCertificate(der);
  return crypto.subtle.importKey("spki", der as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

export async function verifyAadhaarSignature(qr: Pick<AadhaarQr, "signedBytes" | "signature">, key: CryptoKey): Promise<boolean> {
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, qr.signature as BufferSource, qr.signedBytes as BufferSource);
}

export function ageFromYear(year: number | null, today = new Date()): number | null {
  if (!year) return null;
  const a = today.getUTCFullYear() - year;
  return a >= 0 && a <= 120 ? a : null;
}

// ---------- Test cards (staging and demos only) ----------

/**
 * Builds a Secure-QR-format test card signed with a TEST key (not UIDAI's). Only accepted when the
 * server is configured to trust that test key, and always labelled "Test card" in the UI.
 */
export async function makeTestCardQr(
  privateKey: CryptoKey,
  p: { name: string; dob: string; gender: "M" | "F"; last4: string; state: string; district: string; pincode: string },
): Promise<string> {
  const ts = "20260115103000123";
  const fields = ["V2", "2", `${p.last4}${ts}`, p.name, p.dob, p.gender, "S/O Test", p.district, "", "", "", p.pincode, "", p.state, "", "", ""];
  const enc = new TextEncoder();
  const parts: number[] = [];
  for (const f of fields) {
    parts.push(...enc.encode(f), 255);
  }
  parts.push(...new Uint8Array(64)); // stand-in for the photo
  const body = new Uint8Array(parts);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, body));
  const all = new Uint8Array(body.length + sig.length);
  all.set(body);
  all.set(sig, body.length);
  return bytesToDecimal(await gzip(all));
}
