import { useRef, useCallback, useEffect, useState } from 'react';
import { CameraIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not access camera. Please check permissions.');
        }
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(dataUrl);
  }, [onCapture]);

  if (error) {
    return (
      <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Camera</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            onClose();
          }}
        >
          <XIcon className="h-4 w-4" />
        </Button>
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full rounded border bg-black"
      />
      <canvas ref={canvasRef} className="hidden" />
      <Button
        className="w-full"
        size="sm"
        onClick={handleCapture}
        disabled={!ready}
      >
        <CameraIcon className="h-4 w-4 mr-1" />
        Take Photo
      </Button>
    </div>
  );
}
