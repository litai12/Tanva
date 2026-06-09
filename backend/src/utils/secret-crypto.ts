import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';

/**
 * 租户级机密（支付私钥/证书/APIv3 key 等）的对称加密工具。
 *
 * 算法：AES-256-GCM。主密钥来自 env `TENANT_SECRET_KEY`（base64，解码后必须 32 字节）。
 * 密文格式（便于将来轮换算法）：`v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`。
 *
 * Fail-closed：要加密但主密钥缺失/非法 → 抛错，**绝不**把明文落库。
 */

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM 推荐 12 字节
const KEY_LEN = 32;

function loadMasterKey(): Buffer {
  const raw = process.env.TENANT_SECRET_KEY?.trim();
  if (!raw) {
    throw new Error(
      'TENANT_SECRET_KEY 未配置：无法加密/解密租户机密。请在 env 设置 base64 编码的 32 字节密钥。',
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('TENANT_SECRET_KEY 非法：必须是 base64 编码。');
  }
  if (key.length !== KEY_LEN) {
    throw new Error(
      `TENANT_SECRET_KEY 长度错误：解码后需 ${KEY_LEN} 字节，实际 ${key.length} 字节。`,
    );
  }
  return key;
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
