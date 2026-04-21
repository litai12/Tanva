// backend/src/volc-asset/volc-sign.util.ts
import * as crypto from 'crypto';

export interface VolcSignInput {
  accessKey: string;
  secretKey: string;
  region: string;          // e.g. "cn-beijing"
  service: string;         // "ark"
  host: string;            // "open.volcengineapi.com"
  method: 'GET' | 'POST';
  action: string;          // e.g. "CreateAsset"
  version: string;         // "2024-01-01"
  body: string;            // JSON stringified; "" if no body
  date?: Date;
}

export interface VolcSignOutput {
  url: string;
  headers: Record<string, string>;
}

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function formatDate(d: Date): { iso: string; short: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return {
    iso: `${y}${m}${day}T${h}${mi}${s}Z`,
    short: `${y}${m}${day}`,
  };
}

export function signVolcRequest(input: VolcSignInput): VolcSignOutput {
  const { accessKey, secretKey, region, service, host, method, action, version, body } = input;
  const date = input.date ?? new Date();
  const { iso, short } = formatDate(date);

  const canonicalQuery = `Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(version)}`;
  const bodyHash = sha256Hex(body || '');
  const contentType = 'application/json; charset=utf-8';

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-content-sha256:${bodyHash}\n` +
    `x-date:${iso}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';

  const canonicalRequest = [
    method,
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n');

  const credentialScope = `${short}/${region}/${service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    iso,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(secretKey, short);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}/?${canonicalQuery}`,
    headers: {
      'Content-Type': contentType,
      Host: host,
      'X-Date': iso,
      'X-Content-Sha256': bodyHash,
      Authorization: authorization,
    },
  };
}
