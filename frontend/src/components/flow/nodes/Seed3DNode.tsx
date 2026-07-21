import React from "react";
import { Handle, Position } from "@xyflow/react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Download, Send } from "lucide-react";
import { strFromU8, unzipSync } from "fflate";
import RunCreditBadge from "./RunCreditBadge";
import GenerationProgressBar from "./GenerationProgressBar";
import { resolveFlowNodeSendAnchorClient } from "../utils/flowNodeSendAnchor";
import { useLocaleText } from "@/utils/localeText";

type Seed3DDetailPreset = "3.0" | "3.1";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    progressStartedAt?: number | string | null;
    error?: string;
    modelUrl?: string;
    promptId?: string;
    model?: Seed3DDetailPreset;
    lowPoly?: boolean;
    sketch?: boolean;
    creditsPerCall?: number;
    onRun?: (id: string) => void;
  };
  selected?: boolean;
};

const VIEWPORT_HEIGHT = 200;
const PREVIEWABLE_MODEL_EXTENSIONS = new Set(["glb", "gltf"]);
const ZIP_PREVIEWABLE_MODEL_EXTENSIONS = new Set(["glb", "gltf"]);

type ZipModelEntry = {
  path: string;
  normalizedPath: string;
  extension: string;
  bytes: Uint8Array;
};

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function guessMimeTypeByExtension(extension: string): string {
  switch (extension) {
    case "gltf":
      return "model/gltf+json";
    case "glb":
      return "model/gltf-binary";
    case "bin":
      return "application/octet-stream";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "ktx2":
      return "image/ktx2";
    case "basis":
      return "image/basis";
    default:
      return "application/octet-stream";
  }
}

function pickZipPreviewEntry(entries: ZipModelEntry[]): ZipModelEntry | null {
  const previewable = entries.filter((entry) =>
    ZIP_PREVIEWABLE_MODEL_EXTENSIONS.has(entry.extension)
  );
  if (previewable.length === 0) return null;

  const glb = previewable.filter((entry) => entry.extension === "glb");
  if (glb.length > 0) {
    return glb.sort((a, b) => a.normalizedPath.length - b.normalizedPath.length)[0];
  }
  return previewable.sort((a, b) => a.normalizedPath.length - b.normalizedPath.length)[0];
}

function getUrlFileExtension(url: string): string | null {
  if (!url) return null;
  try {
    const path = new URL(url).pathname.toLowerCase();
    const matched = path.match(/\.([a-z0-9]+)$/i);
    return matched?.[1] || null;
  } catch {
    const trimmed = url.split("?")[0]?.toLowerCase() || "";
    const matched = trimmed.match(/\.([a-z0-9]+)$/i);
    return matched?.[1] || null;
  }
}

function Seed3DNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<OrbitControls | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const modelRef = React.useRef<THREE.Object3D | null>(null);
  const gridRef = React.useRef<THREE.GridHelper | null>(null);
  const lastModelUrlRef = React.useRef<string>("");
  const zipResourceUrlsRef = React.useRef<string[]>([]);
  const [hover, setHover] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [previewReady, setPreviewReady] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const modelUrl = typeof data.modelUrl === "string" ? data.modelUrl.trim() : "";
  const modelExtension = getUrlFileExtension(modelUrl);

  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  const currentDetailPreset: Seed3DDetailPreset =
    data.model === "3.0" ? "3.0" : "3.1";
  const lowPolyEnabled = currentDetailPreset === "3.0" ? Boolean(data.lowPoly) : false;
  const sketchEnabled = currentDetailPreset === "3.0" ? Boolean(data.sketch) : false;
  const resolvedRunCredits = 300;

  const updateData = React.useCallback(
    (patch: Record<string, any>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>)
      .nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const requestRender = React.useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
  }, []);

  const revokeZipResources = React.useCallback(() => {
    if (zipResourceUrlsRef.current.length === 0) return;
    zipResourceUrlsRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    });
    zipResourceUrlsRef.current = [];
  }, []);

  const disposeModel = React.useCallback((scene: THREE.Scene) => {
    if (!modelRef.current) return;
    scene.remove(modelRef.current);
    modelRef.current.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      mesh.geometry?.dispose?.();
      if (Array.isArray(material)) {
        material.forEach((item) => item?.dispose?.());
      } else {
        material?.dispose?.();
      }
    });
    modelRef.current = null;
  }, []);

  const computeModelBounds = React.useCallback((root: THREE.Object3D): THREE.Box3 => {
    const box = new THREE.Box3();
    const meshBox = new THREE.Box3();
    const hasBox = { value: false };

    root.updateMatrixWorld(true);
    root.traverse((child) => {
      const mesh = child as THREE.Mesh & {
        isMesh?: boolean;
        isSkinnedMesh?: boolean;
        geometry?: THREE.BufferGeometry;
        pose?: () => void;
      };
      if (!mesh?.isMesh || !mesh.geometry) return;
      if (mesh.isSkinnedMesh && typeof mesh.pose === "function") {
        try {
          mesh.pose();
        } catch {}
      }
      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
      }
      if (!mesh.geometry.boundingBox) return;
      meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      if (!hasBox.value) {
        box.copy(meshBox);
        hasBox.value = true;
      } else {
        box.union(meshBox);
      }
    });

    if (!hasBox.value) {
      box.setFromObject(root, true);
    }
    return box;
  }, []);

  const fitToObject = React.useCallback((object: THREE.Object3D) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const box = computeModelBounds(object);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, Number.EPSILON);

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = Math.max(camera.aspect, Number.EPSILON);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const minFov = Math.max(Math.min(vFov, hFov), Number.EPSILON);
    const distance = (radius / Math.sin(minFov / 2)) * 1.28;

    const direction = new THREE.Vector3(1, 0.82, 1).normalize();
    camera.position.copy(direction.multiplyScalar(distance));
    camera.near = Math.max(distance / 120, 0.01);
    camera.far = Math.max(distance + radius * 6, 120);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  }, [computeModelBounds]);

  React.useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8fafc");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(0, 1.1, 2.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    rendererRef.current = renderer;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.minDistance = 0.2;
    controls.maxDistance = 500;
    controls.addEventListener("change", requestRender);
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(3, 5, 2);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
    fillLight.position.set(-2, 3, -2);
    scene.add(fillLight);
    const grid = new THREE.GridHelper(10, 10, 0xe5e7eb, 0xf1f5f9);
    gridRef.current = grid;
    scene.add(grid);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, true);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      requestRender();
    };
    resize();

    resizeObserverRef.current = new ResizeObserver(resize);
    resizeObserverRef.current.observe(host);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      controls.removeEventListener("change", requestRender);
      controls.dispose();
      controlsRef.current = null;

      disposeModel(scene);
      revokeZipResources();
      if (gridRef.current) {
        scene.remove(gridRef.current);
        gridRef.current.geometry?.dispose?.();
        const mat = gridRef.current.material;
        if (Array.isArray(mat)) {
          mat.forEach((item) => item?.dispose?.());
        } else {
          mat?.dispose?.();
        }
      }
      gridRef.current = null;

      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
    };
  }, [disposeModel, requestRender, revokeZipResources]);

  React.useEffect(() => {
    if (!modelUrl) {
      lastModelUrlRef.current = "";
      setLoadError(null);
      setPreviewReady(false);
      revokeZipResources();
      const scene = sceneRef.current;
      if (scene) {
        disposeModel(scene);
        requestRender();
      }
      return;
    }
    if (modelUrl === lastModelUrlRef.current) return;
    lastModelUrlRef.current = modelUrl;

    const scene = sceneRef.current;
    if (!scene) return;
    setLoadError(null);
    setPreviewReady(false);
    revokeZipResources();

    const loadingManager = new THREE.LoadingManager();
    const loader = new GLTFLoader(loadingManager);
    loader.setCrossOrigin("anonymous");
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
    loader.setDRACOLoader(draco);

    const commitLoadedScene = (root: THREE.Object3D) => {
      const currentScene = sceneRef.current;
      if (!currentScene) return;

      disposeModel(currentScene);
      const rawBox = computeModelBounds(root);
      const center = rawBox.getCenter(new THREE.Vector3());
      root.position.sub(center);
      root.updateMatrixWorld(true);
      modelRef.current = root;
      currentScene.add(root);

      const centeredBox = computeModelBounds(root);
      const centeredSphere = centeredBox.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(centeredSphere.radius, 0.5);
      if (gridRef.current) {
        gridRef.current.scale.setScalar(Math.max(1, Math.min(6, radius / 1.5)));
        gridRef.current.position.set(0, -radius * 0.55, 0);
        gridRef.current.visible = true;
      }

      fitToObject(root);
      requestRender();
      setPreviewReady(true);
    };

    if (modelExtension === "zip") {
      void (async () => {
        try {
          const response = await fetch(modelUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const zipBuffer = await response.arrayBuffer();
          const archive = unzipSync(new Uint8Array(zipBuffer));
          const entries: ZipModelEntry[] = [];

          Object.entries(archive).forEach(([rawPath, bytes]) => {
            if (!bytes || bytes.length === 0) return;
            const normalizedPath = normalizeArchivePath(rawPath);
            const extension = normalizedPath.split(".").pop() || "";
            entries.push({
              path: rawPath,
              normalizedPath,
              extension,
              bytes,
            });
          });

          const mainEntry = pickZipPreviewEntry(entries);
          if (!mainEntry) {
            disposeModel(scene);
            requestRender();
            setLoadError(
              lt(
                "No previewable GLB/GLTF file was found in this ZIP package. Please download it.",
                "No previewable GLB/GLTF file was found in this ZIP package. Please download it."
              )
            );
            return;
          }

          const bytesByNormalizedPath = new Map<string, Uint8Array>();
          entries.forEach((entry) => {
            bytesByNormalizedPath.set(entry.normalizedPath, entry.bytes);
          });

          const resourceUrlByNormalizedPath = new Map<string, string>();
          const getResourceUrl = (requestedPath: string): string | null => {
            const normalizedRequested = normalizeArchivePath(requestedPath);
            if (resourceUrlByNormalizedPath.has(normalizedRequested)) {
              return resourceUrlByNormalizedPath.get(normalizedRequested) || null;
            }
            const source = bytesByNormalizedPath.get(normalizedRequested);
            if (!source) return null;
            const extension = normalizedRequested.split(".").pop() || "";
            const blob = new Blob([toExactArrayBuffer(source)], {
              type: guessMimeTypeByExtension(extension),
            });
            const objectUrl = URL.createObjectURL(blob);
            zipResourceUrlsRef.current.push(objectUrl);
            resourceUrlByNormalizedPath.set(normalizedRequested, objectUrl);
            return objectUrl;
          };

          if (mainEntry.extension === "glb") {
            loader.parse(
              toExactArrayBuffer(mainEntry.bytes),
              "",
              (gltf) => {
                commitLoadedScene(gltf.scene);
              },
              (error) => {
                const message =
                  error instanceof Error
                    ? error.message
                    : typeof error === "string"
                    ? error
                    : "ZIP GLB parse failed";
                disposeModel(scene);
                requestRender();
                setLoadError(
                  lt(`ZIP model preview failed: ${message}`, `ZIP model preview failed: ${message}`)
                );
              }
            );
            return;
          }

          loadingManager.setURLModifier((url) => {
            if (/^(?:https?:|blob:|data:)/i.test(url)) {
              return url;
            }
            const normalizedPath = normalizeArchivePath(
              new URL(url, `https://zip.local/${mainEntry.path}`).pathname
            );
            const resolved = getResourceUrl(normalizedPath);
            return resolved || url;
          });

          try {
            loader.parse(
              strFromU8(mainEntry.bytes),
              "",
              (gltf) => {
                loadingManager.setURLModifier((nextUrl) => nextUrl);
                commitLoadedScene(gltf.scene);
              },
              (error) => {
                loadingManager.setURLModifier((nextUrl) => nextUrl);
                const message =
                  error instanceof Error
                    ? error.message
                    : typeof error === "string"
                    ? error
                    : "ZIP GLTF parse failed";
                disposeModel(scene);
                requestRender();
                setLoadError(
                  lt(`ZIP model preview failed: ${message}`, `ZIP model preview failed: ${message}`)
                );
              }
            );
          } catch (error) {
            loadingManager.setURLModifier((nextUrl) => nextUrl);
            throw error;
          }
        } catch (error) {
          disposeModel(scene);
          requestRender();
          const message =
            error instanceof Error
              ? error.message
              : typeof error === "string"
              ? error
              : "ZIP model preview failed";
          setLoadError(
            lt(`ZIP model preview failed: ${message}`, `ZIP model preview failed: ${message}`)
          );
        }
      })();

      return () => {
        draco.dispose();
      };
    }

    if (modelExtension && !PREVIEWABLE_MODEL_EXTENSIONS.has(modelExtension)) {
      disposeModel(scene);
      requestRender();
      setLoadError(
        lt(
          `Current model format .${modelExtension} cannot be previewed inline. Please download it.`,
          `Current model format .${modelExtension} cannot be previewed inline. Please download it.`
        )
      );
      return () => {
        draco.dispose();
      };
    }

    loader.load(
      modelUrl,
      (gltf) => {
        commitLoadedScene(gltf.scene);
      },
      undefined,
      (error) => {
        console.error("Seed3D model load failed", error);
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
            ? error
            : "3D model load failed";
        disposeModel(scene);
        requestRender();
        setLoadError(lt(`3D model load failed: ${message}`, `3D model load failed: ${message}`));
      }
    );

    return () => {
      draco.dispose();
    };
  }, [
    computeModelBounds,
    revokeZipResources,
    disposeModel,
    fitToObject,
    lt,
    modelExtension,
    modelUrl,
    requestRender,
  ]);
  React.useEffect(() => {
    if (currentDetailPreset === "3.1" && (data.lowPoly || data.sketch)) {
      updateData({ lowPoly: false, sketch: false });
    }
  }, [currentDetailPreset, data.lowPoly, data.sketch, updateData]);

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onDownload = React.useCallback(async () => {
    if (!modelUrl || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(modelUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const extFromType = blob.type.toLowerCase().includes("zip")
        ? "zip"
        : blob.type.toLowerCase().includes("gltf")
        ? "gltf"
        : blob.type.toLowerCase().includes("glb")
        ? "glb"
        : null;
      const fileExtension = extFromType || modelExtension || "glb";
      const fileName = `seed3d_${Date.now()}.${fileExtension}`;
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.warn("Seed3D model download fallback:", error);
      window.open(modelUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }, [downloading, modelExtension, modelUrl]);

  const onSendToCanvas = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!renderer || !scene || !camera) return;

      renderer.render(scene, camera);
      const imageData = renderer.domElement.toDataURL("image/png");
      const anchorClient = resolveFlowNodeSendAnchorClient({
        nodeId: id,
        triggerTarget: event.currentTarget,
      });
      window.dispatchEvent(
        new CustomEvent("triggerQuickImageUpload", {
          detail: {
            imageData,
            fileName: `seed3d_${Date.now()}.png`,
            operationType: "generate",
            anchorClient,
            forceAnchorPosition: true,
          },
        })
      );
    },
    [id]
  );

  return (
    <div
      style={{
        width: 320,
        padding: 8,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div style={{ fontWeight: 600 }}>Seed 3D</div>
        <button
          onClick={onRun}
          disabled={data.status === "running"}
          className="run-btn-with-credit"
          style={{
            fontSize: 12,
            padding: "4px 8px",
            background: data.status === "running" ? "#e5e7eb" : "#111827",
            color: "#fff",
            borderRadius: 6,
            border: "none",
            cursor: data.status === "running" ? "not-allowed" : "pointer",
          }}
        >
          {data.status === "running" ? (
            <span className="run-text-trigger">Running...</span>
          ) : (
            <>
              <span className="run-text-trigger">Run</span>
              <RunCreditBadge credits={resolvedRunCredits} runButton />
            </>
          )}
        </button>
      </div>

      <div style={{ marginBottom: 6 }}>
        <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
          {lt("细节档位", "Detail Preset")}
        </label>
        <select
          value={currentDetailPreset}
          onChange={(event) => {
            const nextPreset = event.target.value === "3.0" ? "3.0" : "3.1";
            updateData({
              model: nextPreset,
              ...(nextPreset === "3.1" ? { lowPoly: false, sketch: false } : {}),
            });
          }}
          className="nodrag nopan nowheel"
          onPointerDownCapture={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          style={{
            width: "100%",
            fontSize: 12,
            padding: "4px 6px",
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            outline: "none",
            background: "#fff",
          }}
        >
          <option value="3.1">{lt("中细节", "Medium Detail")}</option>
          <option value="3.0">{lt("低细节", "Low Detail")}</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            color: currentDetailPreset === "3.0" ? "#374151" : "#9ca3af",
          }}
        >
          <input
            type="checkbox"
            checked={lowPolyEnabled}
            disabled={currentDetailPreset !== "3.0"}
            onChange={(event) => updateData({ lowPoly: event.target.checked })}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          />
          LowPoly
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            color: currentDetailPreset === "3.0" ? "#374151" : "#9ca3af",
          }}
        >
          <input
            type="checkbox"
            checked={sketchEnabled}
            disabled={currentDetailPreset !== "3.0"}
            onChange={(event) => updateData({ sketch: event.target.checked })}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          />
          Sketch
        </label>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          onClick={onDownload}
          disabled={!data.modelUrl || downloading}
          onPointerDownCapture={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            padding: "3px 7px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            background: !data.modelUrl ? "#f3f4f6" : "#fff",
            color: "#111827",
            cursor: !data.modelUrl ? "not-allowed" : "pointer",
          }}
        >
          <Download size={12} />
          Download
        </button>
        <button
          type="button"
          onClick={onSendToCanvas}
          disabled={!modelUrl || !previewReady}
          onPointerDownCapture={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            padding: "3px 7px",
            borderRadius: 6,
            border: "1px solid #111827",
            background: !modelUrl || !previewReady ? "#e5e7eb" : "#111827",
            color: "#fff",
            cursor: !modelUrl || !previewReady ? "not-allowed" : "pointer",
          }}
        >
          <Send size={12} />
          Send
        </button>
      </div>

      <div
        className="nodrag nopan nowheel"
        data-flow-three-node-viewport="true"
        style={{
          width: "100%",
          height: VIEWPORT_HEIGHT,
          borderRadius: 6,
          border: "1px solid #e5e7eb",
          background: "#f8fafc",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        {!modelUrl ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              color: "#9ca3af",
              pointerEvents: "none",
            }}
          >
            {lt("等待 3D 模型结果", "Waiting for 3D model result")}
          </div>
        ) : null}
      </div>

      {data.promptId ? (
        <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280", wordBreak: "break-all" }}>
          Job: {data.promptId}
        </div>
      ) : null}

      <GenerationProgressBar
        status={data.status}
        simulateDurationMs={60 * 1000}
        startedAt={data.progressStartedAt}
        runKey={id}
      />

      {(data.status === "failed" && data.error) || loadError ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {data.error || loadError}
        </div>
      ) : null}

      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: "35%" }}
        onMouseEnter={() => setHover("img-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: "65%" }}
        onMouseEnter={() => setHover("prompt-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="model"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("model-out")}
        onMouseLeave={() => setHover(null)}
      />

      {hover === "img-in" ? (
        <div className="flow-tooltip" style={{ left: -8, top: "35%", transform: "translate(-100%, -50%)" }}>
          image
        </div>
      ) : null}
      {hover === "prompt-in" ? (
        <div className="flow-tooltip" style={{ left: -8, top: "65%", transform: "translate(-100%, -50%)" }}>
          prompt
        </div>
      ) : null}
      {hover === "model-out" ? (
        <div className="flow-tooltip" style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}>
          model
        </div>
      ) : null}
    </div>
  );
}

export default React.memo(Seed3DNode);
