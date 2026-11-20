import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
} from 'crypto';

/**
 * 租户级机密（支付私钥/证书/APIv3 key 等）的对称加密工具。
 *
 * 算法：AES-256-GCM。主密钥按以下优先级取得：
 *   1. env `TENANT_SECRET_KEY`（base64，解码后必须 32 字节）—— 生产推荐，可独立轮换；
 *   2. 否则从已有的应用级密钥 `JWT_REFRESH_SECRET`（退而 `JWT_ACCESS_SECRET`）经 HKDF-SHA256 派生
 *      —— 每环境唯一、**不进源码**，免去新增运维项即"自带默认值"。
 *
 * 之所以不放写死的公开默认常量：那等于把密文对任何能看到代码的人变成明文，架空加密本身。
 * 派生方案保留「攻击者还需拿到该环境的 JWT 密钥才能解密」的真实保护。
 *
 * 密文格式（便于将来轮换算法）：`v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`。
 * Fail-closed：连派生来源都没有时加密抛错，**绝不**把明文落库。
 *
 * ⚠ 轮换注意：若依赖派生（未设 TENANT_SECRET_KEY）且轮换了 JWT_REFRESH_SECRET，
 *   已有密文将无法解密。对需独立轮换的生产环境，建议显式设 TENANT_SECRET_KEY。
 */

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM 推荐 12 字节
const KEY_LEN = 32;
const DERIVE_SALT = 'tanva:tenant-payment-secret:v1';
const DERIVE_INFO = 'aes-256-gcm-master-key';

function loadMasterKey(): Buffer {
  // 1. 显式主密钥（base64 32 字节）
  const explicit = process.env.TENANT_SECRET_KEY?.trim();
  if (explicit) {
    const key = Buffer.from(explicit, 'base64');
    if (key.length !== KEY_LEN) {
      throw new Error(
        `TENANT_SECRET_KEY 长度错误：base64 解码后需 ${KEY_LEN} 字节，实际 ${key.length} 字节。`,
      );
    }
    return key;
  }
  // 2. 回落：从已有应用级密钥派生（不进源码、每环境唯一）
  const ikm =
    process.env.JWT_REFRESH_SECRET?.trim() || process.env.JWT_ACCESS_SECRET?.trim();
  if (ikm) {
    const derived = hkdfSync('sha256', ikm, DERIVE_SALT, DERIVE_INFO, KEY_LEN);
    return Buffer.from(derived);
  }
  throw new Error(
    '无法取得加密主密钥：请设置 TENANT_SECRET_KEY（base64 32 字节），或确保已配置 JWT_REFRESH_SECRET 供派生。',
  );
}

/** 是否为本工具产出的密文（带版本前缀）。 */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}

/** 主密钥是否就绪（用于启动期/管理端友好提示，不暴露密钥本身）。 */
export function isSecretCryptoReady(): boolean {
  try {
    loadMasterKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * 加密明文。空串/undefined 返回 null（表示"清除该字段"）。
 * 已是密文则原样返回（幂等，避免双重加密）。
 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  const text = String(plain);
  if (text.length === 0) return null;
  if (isEncrypted(text)) return text;

  const key = loadMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/**
 * 解密密文，返回明文。
 * - null/空 → null
 * - 非本工具格式（历史明文）→ 原样返回（向后兼容），便于平滑迁移
 */
export function decryptSecret(enc: string | null | undefined): string | null {
  if (enc == null) return null;
  const text = String(enc);
  if (text.length === 0) return null;
  if (!isEncrypted(text)) {
    // 兼容历史明文存储：直接返回
    return text;
  }
  const parts = text.split(':');
  if (parts.length !== 4) {
    throw new Error('密文格式非法：期望 v1:<iv>:<tag>:<ct>');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = loadMasterKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}
