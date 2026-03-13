/**
 * 系统支持的底层 API 协议类型
 * 这是全局唯一的协议枚举，PayloadBuilder、节点管理、试炼场均依赖此定义
 */
export enum ApiProtocolType {
  /** 通用 OpenAI 兼容协议（文本生成、图像生成等） */
  OPENAI_COMPATIBLE = 'OPENAI_COMPATIBLE',

  /** 可灵官方原生格式 */
  KLING_NATIVE = 'KLING_NATIVE',

  /** Vidu 官方原生格式 */
  VIDU_NATIVE = 'VIDU_NATIVE',

  /** 豆包火山引擎原生格式（Seedance） */
  DOUBAO_VOLC_NATIVE = 'DOUBAO_VOLC_NATIVE',

  /** 通用异步代理标准格式（APIMart / 新147 / 贞贞等兼容此协议） */
  ASYNC_PROXY_STANDARD = 'ASYNC_PROXY_STANDARD',
}

export interface ProtocolDescriptor {
  value: ApiProtocolType;
  label: string;
  description: string;
}

export const PROTOCOL_DESCRIPTORS: ProtocolDescriptor[] = [
  {
    value: ApiProtocolType.OPENAI_COMPATIBLE,
    label: '通用 OpenAI 兼容协议',
    description: '兼容 OpenAI Chat Completions / Images 规范的通用接口',
  },
  {
    value: ApiProtocolType.KLING_NATIVE,
    label: '可灵原生协议',
    description: '可灵（Kling）官方 API 原生格式，使用 model_name 字段',
  },
  {
    value: ApiProtocolType.VIDU_NATIVE,
    label: 'Vidu 原生协议',
    description: 'Vidu 官方 API 原生格式',
  },
  {
    value: ApiProtocolType.DOUBAO_VOLC_NATIVE,
    label: '豆包火山引擎原生协议',
    description: '豆包 Seedance 火山引擎原生格式，使用 content 数组结构',
  },
  {
    value: ApiProtocolType.ASYNC_PROXY_STANDARD,
    label: '通用异步代理标准协议',
    description: '适用于 APIMart、新147、贞贞等异步代理平台的标准格式',
  },
];
