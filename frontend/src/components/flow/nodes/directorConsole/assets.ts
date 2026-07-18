export type PropShape =
  | 'box' | 'sphere' | 'cylinder' | 'torus' | 'cone' | 'pyramid' | 'plane'
  | 'table' | 'low-table' | 'chair' | 'stool' | 'sofa' | 'bed' | 'cabinet' | 'sideboard' | 'shelf' | 'lamp'

export type BodyProfile = {
  height: number
  headRadius: number
  shoulderWidth: number
  hipWidth: number
  torsoLength: number
  torsoRadiusTop: number
  torsoRadiusBottom: number
  upperArm: number
  forearm: number
  armRadius: number
  thigh: number
  shin: number
  legRadius: number
}

export type LibraryItem =
  | { id: string; name: string; kind: 'body'; url?: string; heightM: number; widthScale?: number; profile?: BodyProfile }
  | { id: string; name: string; kind: 'prop'; shape: PropShape; defaultColor?: string }
  | { id: string; name: string; kind: 'empty' }
  | { id: string; name: string; kind: 'gaussian'; url: string }
  | { id: string; name: string; kind: 'reference'; url: string }

// 自托管素体 GLB（标准 Mixamo 骨骼 X Bot，T-pose 绑定，见 public/director/ATTRIBUTION.md），可用环境变量覆盖为自有模型。
// 姿势系统按人形骨骼校准（pose.ts）：Mixamo 命名精确映射，其它命名走模糊匹配。
// 自建的八套独立 blocking 素体。每套有不同的头身比、肩髋比、躯干截面、
// 四肢长度与粗细，并共享可姿势化的关节命名；不再复用 XBot 做整体缩放。
export const BODY_TYPES: LibraryItem[] = [
  { id: 'male', name: '男性素体', kind: 'body', heightM: 1.78, profile: { height: 1.78, headRadius: .115, shoulderWidth: .46, hipWidth: .30, torsoLength: .53, torsoRadiusTop: .205, torsoRadiusBottom: .145, upperArm: .31, forearm: .28, armRadius: .062, thigh: .43, shin: .43, legRadius: .082 } },
  { id: 'female', name: '女性素体', kind: 'body', heightM: 1.66, profile: { height: 1.66, headRadius: .112, shoulderWidth: .38, hipWidth: .33, torsoLength: .49, torsoRadiusTop: .17, torsoRadiusBottom: .155, upperArm: .285, forearm: .255, armRadius: .052, thigh: .40, shin: .39, legRadius: .07 } },
  { id: 'broad', name: '宽厚素体', kind: 'body', heightM: 1.74, profile: { height: 1.74, headRadius: .122, shoulderWidth: .56, hipWidth: .40, torsoLength: .50, torsoRadiusTop: .255, torsoRadiusBottom: .205, upperArm: .29, forearm: .265, armRadius: .085, thigh: .40, shin: .39, legRadius: .105 } },
  { id: 'muscular', name: '健壮素体', kind: 'body', heightM: 1.82, profile: { height: 1.82, headRadius: .116, shoulderWidth: .54, hipWidth: .32, torsoLength: .55, torsoRadiusTop: .245, torsoRadiusBottom: .155, upperArm: .32, forearm: .29, armRadius: .082, thigh: .45, shin: .43, legRadius: .10 } },
  { id: 'slim', name: '纤细素体', kind: 'body', heightM: 1.72, profile: { height: 1.72, headRadius: .108, shoulderWidth: .36, hipWidth: .27, torsoLength: .54, torsoRadiusTop: .15, torsoRadiusBottom: .125, upperArm: .32, forearm: .29, armRadius: .043, thigh: .43, shin: .43, legRadius: .058 } },
  { id: 'teen', name: '少年素体', kind: 'body', heightM: 1.50, profile: { height: 1.50, headRadius: .118, shoulderWidth: .34, hipWidth: .27, torsoLength: .42, torsoRadiusTop: .145, torsoRadiusBottom: .125, upperArm: .255, forearm: .235, armRadius: .045, thigh: .35, shin: .35, legRadius: .06 } },
  { id: 'child', name: '儿童素体', kind: 'body', heightM: 1.20, profile: { height: 1.20, headRadius: .13, shoulderWidth: .27, hipWidth: .23, torsoLength: .31, torsoRadiusTop: .125, torsoRadiusBottom: .115, upperArm: .19, forearm: .175, armRadius: .04, thigh: .255, shin: .245, legRadius: .052 } },
  { id: 'chibi', name: '二头身', kind: 'body', heightM: 1.00, profile: { height: 1.00, headRadius: .23, shoulderWidth: .30, hipWidth: .25, torsoLength: .25, torsoRadiusTop: .145, torsoRadiusBottom: .135, upperArm: .15, forearm: .13, armRadius: .048, thigh: .18, shin: .17, legRadius: .06 } },
]

export const PROP_TYPES: LibraryItem[] = [
  { id: 'prop-box', name: '立方体', kind: 'prop', shape: 'box' },
  { id: 'prop-sphere', name: '球体', kind: 'prop', shape: 'sphere' },
  { id: 'prop-cylinder', name: '圆柱', kind: 'prop', shape: 'cylinder' },
  { id: 'prop-torus', name: '圆环', kind: 'prop', shape: 'torus' },
  { id: 'prop-cone', name: '圆锥', kind: 'prop', shape: 'cone' },
  { id: 'prop-pyramid', name: '棱锥', kind: 'prop', shape: 'pyramid' },
  { id: 'prop-plane', name: '平面', kind: 'prop', shape: 'plane' },
]

export const EMPTY_OBJECT: LibraryItem = { id: 'empty-object', name: '空对象', kind: 'empty' }

// 家具道具：程序化组合几何体（CharacterObject.tsx PropObject），blocking 占位风格，真实米制尺寸、底面落地 y=0。
export const FURNITURE_TYPES: LibraryItem[] = [
  { id: 'prop-table', name: '桌子', kind: 'prop', shape: 'table', defaultColor: '#A1795B' },
  { id: 'prop-low-table', name: '茶几', kind: 'prop', shape: 'low-table', defaultColor: '#A1795B' },
  { id: 'prop-chair', name: '椅子', kind: 'prop', shape: 'chair', defaultColor: '#B08968' },
  { id: 'prop-stool', name: '凳子', kind: 'prop', shape: 'stool', defaultColor: '#B08968' },
  { id: 'prop-sofa', name: '沙发', kind: 'prop', shape: 'sofa', defaultColor: '#76808F' },
  { id: 'prop-bed', name: '床', kind: 'prop', shape: 'bed', defaultColor: '#9FA8B8' },
  { id: 'prop-cabinet', name: '柜子', kind: 'prop', shape: 'cabinet', defaultColor: '#8B6F52' },
  { id: 'prop-sideboard', name: '矮柜', kind: 'prop', shape: 'sideboard', defaultColor: '#8B6F52' },
  { id: 'prop-shelf', name: '书架', kind: 'prop', shape: 'shelf', defaultColor: '#8B6F52' },
  { id: 'prop-lamp', name: '落地灯', kind: 'prop', shape: 'lamp', defaultColor: '#C9CDD6' },
]

export const LIBRARY: LibraryItem[] = [...BODY_TYPES, EMPTY_OBJECT, ...FURNITURE_TYPES, ...PROP_TYPES]

export function getLibraryItem(modelId: string): LibraryItem | undefined {
  const found = LIBRARY.find((m) => m.id === modelId)
  if (found) return found
  if (modelId.startsWith('reference-image:')) {
    return { id: modelId, name: '站位参考', kind: 'reference', url: modelId.slice('reference-image:'.length) }
  }
  // 本地上传：modelId 直接是 blob/http URL
  if (/^(https?:|projects\/|uploads\/)/.test(modelId) && /\.splat(?:[?#]|$)/i.test(modelId)) {
    return { id: modelId, name: '高斯泼溅', kind: 'gaussian', url: modelId }
  }
  if (/^(blob:|https?:|projects\/|uploads\/)/.test(modelId)) {
    return { id: modelId, name: '上传素体', kind: 'body', url: modelId, heightM: 1.7 }
  }
  return undefined
}
