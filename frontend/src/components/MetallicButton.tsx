import { useEffect, useRef } from 'react';
import './MetallicButton.css';

interface MetallicButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  enableWebcam?: boolean;
}

export default function MetallicButton({
  children,
  onClick,
  className = '',
  enableWebcam = true
}: MetallicButtonProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!enableWebcam) return;

    let stream: MediaStream | null = null;

    const startWebcam = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 320 },
            height: { ideal: 180 },
            facingMode: 'user'
          }
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Error accessing webcam:', err);
      }
    };

    startWebcam();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [enableWebcam]);

  return (
    <span className="metallic-button-outer">
      <button className={`metallic-button ${className}`} onClick={onClick}>
        <svg className="metallic-svg-filters" aria-hidden="true">
          <defs>
            <filter id="metallic-btn-filter" x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="2" result="noise" />
              <feColorMatrix in="noise" type="luminanceToAlpha" result="noiseAlpha" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="8"
                xChannelSelector="R"
                yChannelSelector="G"
                result="rippled"
              />
              <feSpecularLighting
                in="noiseAlpha"
                surfaceScale="8"
                specularConstant="1.0"
                specularExponent="20"
                lightingColor="#ffffff"
                result="light"
              >
                <fePointLight x="100" y="0" z="200" />
              </feSpecularLighting>
              <feComposite in="light" in2="rippled" operator="in" result="light-effect" />
              <feBlend in="light-effect" in2="rippled" mode="screen" result="metallic-result" />
            </filter>
          </defs>
        </svg>

        {enableWebcam && (
          <div className="metallic-video-wrapper">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="metallic-video"
            />
          </div>
        )}

        <div className="metallic-noise" />
        <div className="metallic-sheen" />
        <div className="metallic-border" />
        <span className="metallic-text">{children}</span>
      </button>
    </span>
  );
}
