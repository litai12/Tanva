import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';
import { useEffect, useRef } from 'react';
import './Iridescence.css';

const vertexShader = `
attribute vec2 uv;
attribute vec2 position;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uColor;
uniform vec3 uResolution;
uniform vec2 uMouse;
uniform float uAmplitude;
uniform float uSpeed;

varying vec2 vUv;

void main() {
  float mr = min(uResolution.x, uResolution.y);
  vec2 uv = (vUv.xy * 2.0 - 1.0) * uResolution.xy / mr;

  uv += (uMouse - vec2(0.5)) * uAmplitude;

  float d = -uTime * 0.5 * uSpeed;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * uv.x);
    d += sin(uv.y * i + a);
  }
  d += uTime * 0.5 * uSpeed;
  vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;
  gl_FragColor = vec4(col, 1.0);
}
`;

interface IridescenceProps {
  color?: [number, number, number];
  speed?: number;
  amplitude?: number;
  mouseReact?: boolean;
  className?: string;
}

export default function Iridescence({
  color = [1, 1, 1],
  speed = 1.0,
  amplitude = 0.1,
  mouseReact = true,
  className = '',
  ...rest
}: IridescenceProps) {
  const ctnDom = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const programRef = useRef<Program | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const geometryRef = useRef<Triangle | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const mouseHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!ctnDom.current) return;
    const ctn = ctnDom.current;
    if (rendererRef.current) return;

    const renderer = new Renderer({ dpr: 1 });
    const gl = renderer.gl;
    if (!gl) return;
    gl.clearColor(0, 0, 0, 1);

    const resolution = new Color(1, 1, 1);
    const uMouse = new Float32Array([0.5, 0.5]);
    const uColor = new Color(...color);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: uColor },
        uResolution: { value: resolution },
        uMouse: { value: uMouse },
        uAmplitude: { value: amplitude },
        uSpeed: { value: speed }
      }
    });
    const mesh = new Mesh(gl, { geometry, program });

    rendererRef.current = renderer;
    programRef.current = program;
    meshRef.current = mesh;
    geometryRef.current = geometry;

    function resize() {
      const width = Math.max(1, Math.floor(ctn.offsetWidth));
      const height = Math.max(1, Math.floor(ctn.offsetHeight));
      renderer.setSize(width, height);
      const w = gl.canvas.width;
      const h = gl.canvas.height;
      resolution[0] = w;
      resolution[1] = h;
      resolution[2] = w / h;
    }
    resizeRef.current = resize;
    window.addEventListener('resize', resize, false);
    resize();

    function update(t: number) {
      rafIdRef.current = requestAnimationFrame(update);
      program.uniforms.uTime.value = t * 0.001;
      renderer.render({ scene: mesh });
    }
    ctn.appendChild(gl.canvas);

    function handleMouseMove(e: MouseEvent) {
      const rect = ctn.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;
      uMouse[0] = x;
      uMouse[1] = y;
    }
    mouseHandlerRef.current = handleMouseMove;

    function start() {
      if (rafIdRef.current != null) return;
      rafIdRef.current = requestAnimationFrame(update);
    }
    function stop() {
      if (rafIdRef.current == null) return;
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    start();

    const handleVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    visibilityHandlerRef.current = handleVisibilityChange;
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => resize());
      ro.observe(ctn);
      resizeObserverRef.current = ro;
    }

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      ctn.removeEventListener('mousemove', handleMouseMove);
      if (ctn.contains(gl.canvas)) {
        ctn.removeChild(gl.canvas);
      }

      geometry.remove();
      program.remove();
      gl.getExtension('WEBGL_lose_context')?.loseContext();

      rendererRef.current = null;
      programRef.current = null;
      meshRef.current = null;
      geometryRef.current = null;
      mouseHandlerRef.current = null;
      resizeRef.current = null;
      visibilityHandlerRef.current = null;
    };
  }, []);

  const colorR = color[0];
  const colorG = color[1];
  const colorB = color[2];

  useEffect(() => {
    const program = programRef.current;
    if (!program) return;
    (program.uniforms.uColor.value as Color).set(colorR, colorG, colorB);
  }, [colorR, colorG, colorB]);

  useEffect(() => {
    const program = programRef.current;
    if (!program) return;
    program.uniforms.uSpeed.value = speed;
  }, [speed]);

  useEffect(() => {
    const program = programRef.current;
    if (!program) return;
    program.uniforms.uAmplitude.value = amplitude;
  }, [amplitude]);

  useEffect(() => {
    const ctn = ctnDom.current;
    const mouseHandler = mouseHandlerRef.current;
    if (!ctn || !mouseHandler) return;
    if (mouseReact) ctn.addEventListener('mousemove', mouseHandler);
    else ctn.removeEventListener('mousemove', mouseHandler);
    return () => ctn.removeEventListener('mousemove', mouseHandler);
  }, [mouseReact]);

  return <div ref={ctnDom} className={`iridescence-container ${className}`} {...rest} />;
}
