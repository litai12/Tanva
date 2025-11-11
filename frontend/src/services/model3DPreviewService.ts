import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { logger } from '@/utils/logger';

export interface Model3DPreviewOptions {
  width?: number;
  height?: number;
  /** 背景色（CSS 颜色值），默认使用深色卡片背景 */
  background?: string;
  /** 相机距离 padding 系数，值越大模型越远 */
  padding?: number;
}

const DEFAULT_PREVIEW_OPTIONS: Required<Model3DPreviewOptions> = {
  width: 420,
  height: 260,
  background: '#0f172a',
  padding: 2,
};

const previewPromiseCache = new Map<string, Promise<string | null>>();
const tempVector = new THREE.Vector3();

function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function disposeMaterial(material: THREE.Material | undefined): void {
  if (!material) return;
  const anyMat = material as any;
  anyMat.map?.dispose?.();
  anyMat.normalMap?.dispose?.();
  anyMat.roughnessMap?.dispose?.();
  anyMat.metalnessMap?.dispose?.();
  anyMat.aoMap?.dispose?.();
  anyMat.bumpMap?.dispose?.();
  anyMat.emissiveMap?.dispose?.();
  anyMat.clearcoatMap?.dispose?.();
  anyMat.clearcoatNormalMap?.dispose?.();
  anyMat.clearcoatRoughnessMap?.dispose?.();
  material.dispose();
}

function disposeObject3D(object: THREE.Object3D | null | undefined): void {
  if (!object) return;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => disposeMaterial(mat));
      } else {
        disposeMaterial(mesh.material);
      }
    }
  });
}

function createLoader() {
  const loader = new GLTFLoader();
  loader.setCrossOrigin('anonymous');
  let dracoLoader: DRACOLoader | null = null;
  try {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(dracoLoader);
  } catch (error) {
    logger.warn('初始化 Draco 解码器失败，预览将降级为普通加载', error);
  }
  return { loader, dracoLoader };
}

function setupLighting(scene: THREE.Scene) {
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(6, 8, 6);
  const rim = new THREE.DirectionalLight(0xffffff, 0.45);
  rim.position.set(-6, 4, -6);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x0f172a, 0.35);
  scene.add(ambient, key, rim, hemi);
}

function frameCamera(object: THREE.Object3D, camera: THREE.PerspectiveCamera, padding: number): boolean {
  const bounds = new THREE.Box3().setFromObject(object);
  if (!isFinite(bounds.min.x) || bounds.isEmpty()) {
    return false;
  }
  const size = bounds.getSize(tempVector);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.sub(center);

  const maxDimension = Math.max(size.x, size.y, size.z, Number.EPSILON);
  const distance = (maxDimension / (2 * Math.tan((camera.fov * Math.PI) / 360))) * padding;
  const direction = new THREE.Vector3(1, 0.9, 0.95).normalize();
  camera.position.copy(direction.multiplyScalar(distance));
  camera.lookAt(new THREE.Vector3(0, 0, 0));
  camera.up.set(0, 1, 0);
  camera.updateProjectionMatrix();
  return true;
}

function renderPreview(object: THREE.Object3D, options: Required<Model3DPreviewOptions>): string | null {
  if (!isBrowserEnvironment()) return null;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(options.width, options.height, false);
  renderer.setClearColor(new THREE.Color(options.background), 1);
  if ('outputColorSpace' in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else {
    // @ts-expect-error older three fallback
    renderer.outputEncoding = THREE.sRGBEncoding;
  }

  const scene = new THREE.Scene();
  setupLighting(scene);
  scene.add(object);

  const camera = new THREE.PerspectiveCamera(32, options.width / options.height, 0.01, 1000);
  const framed = frameCamera(object, camera, options.padding);
  if (!framed) {
    renderer.dispose();
    disposeObject3D(object);
    scene.clear();
    return null;
  }

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');

  disposeObject3D(object);
  scene.clear();
  renderer.dispose();

  return dataUrl;
}

function createCacheKey(url: string, options: Required<Model3DPreviewOptions>): string {
  return `${url}|${options.width}x${options.height}|${options.background}|${options.padding}`;
}

async function generatePreviewFromUrl(url: string, options: Model3DPreviewOptions = {}): Promise<string | null> {
  if (!url || !isBrowserEnvironment()) {
    return null;
  }
  const merged = { ...DEFAULT_PREVIEW_OPTIONS, ...options };
  const cacheKey = createCacheKey(url, merged);
  const cachedTask = previewPromiseCache.get(cacheKey);
  if (cachedTask) return cachedTask;

  const task = (async () => {
    const { loader, dracoLoader } = createLoader();
    try {
      const gltf = await loader.loadAsync(url);
      if (!gltf?.scene) {
        return null;
      }
      return renderPreview(gltf.scene, merged);
    } catch (error) {
      logger.warn('生成 3D 预览失败', error);
      return null;
    } finally {
      previewPromiseCache.delete(cacheKey);
      try {
        dracoLoader?.dispose?.();
      } catch {
        // ignore
      }
    }
  })();

  previewPromiseCache.set(cacheKey, task);
  return task;
}

export const model3DPreviewService = {
  generatePreviewFromUrl,
};
