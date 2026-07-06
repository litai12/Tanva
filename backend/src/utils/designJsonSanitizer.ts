const DATA_URL_PREFIX = /^data:/i;
const BLOB_URL_PREFIX = /^blob:/i;

const BASE64_IMAGE_MAGIC_PREFIXES = [
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  'iVBORw0KGgo',
  // JPEG: FF D8 FF
  '/9j/',
  // GIF: GIF8
  'R0lGOD',
  // WEBP: RIFF....WEBP
  'UklGR',
  // SVG: <svg
  'PHN2Zy',
] as const;

const looksLikeBase64 = (value: string): boolean => {
  const compact = value.replace(/\s+/g, '');
  if (compact.length < 4096) return false;
  if (compact.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
};

const looksLikeEmbeddedImageString = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (DATA_URL_PREFIX.test(trimmed) || BLOB_URL_PREFIX.test(trimmed)) return true;

  const compact = trimmed.replace(/\s+/g, '');
  if (
    BASE64_IMAGE_MAGIC_PREFIXES.some((prefix) => compact.startsWith(prefix)) &&
    compact.length >= 32
  ) {
    return true;
  }

  return looksLikeBase64(compact);
};

function sanitizeString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return value;
  return looksLikeEmbeddedImageString(trimmed) ? undefined : value;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      const sanitizedChild = sanitizeValue(child);
      if (sanitizedChild === undefined) return;
      next[key] = sanitizedChild;
    });
    return next;
  }

  return value;
}

/**
 * 设计 JSON（Project.contentJson / PublicTemplate.templateData）清洗：
 * - 禁止 data: / blob: / 内联 base64 进入持久化存储
 * - 仅保留可长期访问的 URL / 路径 / 普通文本字段
 */
export function sanitizeDesignJson<T = unknown>(input: T): T {
  return sanitizeValue(input) as T;
}

/**
 * 判定画布节点是否为"幽灵节点"：有 string id（节点签名）但缺少有效 type。
 * 协作局部补丁(位置/数据)误建出的节点没有 type，前端兜底会存成 type:"default"；
 * 这两类都不在前端 nodeTypes 注册表里，渲染成一个空白小方框（用户所说的"未知节点"）。
 * 真实节点在创建时一定带有效 type，故此判定不会误伤正常节点。
 */
function isGhostFlowNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  if (typeof n.id !== 'string') return false;
  const type = n.type;
  if (typeof type !== 'string') return true;
  const trimmed = type.trim();
  return trimmed === '' || trimmed === 'default';
}

/**
 * 丢弃画布快照里无 type 的"幽灵节点"。这类脏数据由协作端误建并被某一成员的自动保存
 * 写入了唯一共享快照；之后任何成员刷新都会从该共享快照里把它读出来渲染成空白方框。
 * 在持久化这一唯一共享入口统一拦截，可保护所有客户端（含未升级的旧前端），并在下一次
 * 保存时把已被污染的快照清理干净。注意：会原地修改传入对象（应传入 sanitize 后的克隆）。
 */
export function dropGhostFlowNodes<T = unknown>(input: T): T {
  if (!input || typeof input !== 'object') return input;
  const root = input as Record<string, any>;
  let dropped = 0;
  const clean = (holder: Record<string, any> | undefined | null) => {
    if (holder && Array.isArray(holder.nodes)) {
      const before = holder.nodes.length;
      holder.nodes = holder.nodes.filter((nd: unknown) => !isGhostFlowNode(nd));
      dropped += before - holder.nodes.length;
    }
  };
  clean(root.flow); // 规范路径 content.flow.nodes
  clean(root); // 兼容可能存在的旧版顶层 content.nodes
  if (dropped > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[collab] 持久化画布时丢弃了 ${dropped} 个无 type 的幽灵节点(脏数据)`,
    );
  }
  return input;
}
