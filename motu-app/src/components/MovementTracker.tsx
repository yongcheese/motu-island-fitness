import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { PoseLandmarker, FilesetResolver, Landmark, DrawingUtils } from '@mediapipe/tasks-vision';
import { Button } from './UI/DesignKit';

interface MovementTrackerProps {
  onRepDetected: () => void;
  exerciseType: 'jumping-jacks' | 'squats';
  isActive: boolean;
}

export function MovementTracker({ onRepDetected, exerciseType, isActive }: MovementTrackerProps) {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [cameraError, setCameraError] = useState<boolean>(false);
  const lastStateRef = useRef<'up' | 'down' | 'open' | 'closed'>('closed');
  
  // Exercise Detection Logic
  const detectExercise = (landmarks: Landmark[]) => {
    if (!landmarks || landmarks.length < 33) return;

    // MediaPipe Indices:
    // Left Shoulder: 11, Right Shoulder: 12
    // Left Hip: 23, Right Hip: 24
    // Left Knee: 25, Right Knee: 26
    // Left Wrist: 15, Right Wrist: 16

    if (exerciseType === 'squats') {
      const hipY = (landmarks[23].y + landmarks[24].y) / 2;
      const kneeY = (landmarks[25].y + landmarks[26].y) / 2;
      
      // If hip is close to or below knee, it's a squat "down"
      const currentPos = (kneeY - hipY < 0.15) ? 'down' : 'up';
      
      if (lastStateRef.current === 'up' && currentPos === 'down') {
        lastStateRef.current = 'down';
      } else if (lastStateRef.current === 'down' && currentPos === 'up') {
        lastStateRef.current = 'up';
        onRepDetected();
      }
    } else if (exerciseType === 'jumping-jacks') {
      const leftWristY = landmarks[15].y;
      const rightWristY = landmarks[16].y;
      const eyeY = landmarks[0].y;
      
      // If wrists are above head
      const currentPos = (leftWristY < eyeY && rightWristY < eyeY) ? 'open' : 'closed';
      
      if (lastStateRef.current === 'closed' && currentPos === 'open') {
        lastStateRef.current = 'open';
        onRepDetected();
      } else if (lastStateRef.current === 'open' && currentPos === 'closed') {
        lastStateRef.current = 'closed';
      }
    }
  };

  useEffect(() => {
    let animationFrameId: number;

    const setupPoseLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        
        poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });
        
        setIsLoaded(true);
        predictWebcam();
      } catch (err) {
        console.error("Failed to setup MediaPipe PoseLandmarker:", err);
        // If MediaPipe resolver or task fails to load (offline or blocked), fallback gracefully too
        setIsLoaded(true);
      }
    };

    const predictWebcam = async () => {
      if (cameraError) return;
      if (
        poseLandmarkerRef.current &&
        webcamRef.current &&
        webcamRef.current.video?.readyState === 4 &&
        isActive
      ) {
        const video = webcamRef.current.video;
        const canvas = canvasRef.current;
        
        if (canvas) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const drawingUtils = new DrawingUtils(ctx);
            const startTimeMs = performance.now();
            const results = poseLandmarkerRef.current.detectForVideo(video, startTimeMs);

            if (results.landmarks && results.landmarks.length > 0) {
              const landmarks = results.landmarks[0];
              detectExercise(landmarks);
              
              // Draw landmarks
              drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
                color: "#10b981",
                lineWidth: 4
              });
              drawingUtils.drawLandmarks(landmarks, {
                color: "#ffffff",
                lineWidth: 2,
                radius: 4
              });
            }
          }
        }
      }
      animationFrameId = requestAnimationFrame(predictWebcam);
    };

    if (isActive) {
      setupPoseLandmarker();
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      poseLandmarkerRef.current?.close();
    };
  }, [isActive, exerciseType, cameraError]);

  if (!isActive) return null;

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center">
      {!cameraError ? (
        <>
          <Webcam
            ref={webcamRef}
            audio={false}
            className="h-full w-full object-cover mirror"
            videoConstraints={{
              facingMode: "user",
              width: 1280,
              height: 720
            }}
            mirrored={true}
            onUserMediaError={() => {
              setCameraError(true);
              setIsLoaded(true);
            }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full object-cover mirror pointer-events-none"
            style={{ transform: 'scaleX(-1)' }}
          />
          {!isLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md">
              <div className="w-12 h-12 border-4 border-island-teal border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-white font-bold tracking-widest text-sm uppercase">正在初始化 AI 視覺系統...</p>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center p-8 text-center max-w-lg mx-auto bg-island-navy/90 border border-white/10 rounded-[3rem] shadow-[0_20px_48px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <div className="w-20 h-20 bg-island-teal/10 border-2 border-island-teal/30 text-island-teal-light rounded-full flex items-center justify-center mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <h3 className="text-white font-black text-2xl mb-2">自主訓練計數模式</h3>
          <p className="text-white/60 text-sm mb-8 leading-relaxed">
            系統未偵測到相機或權限被拒絕。不用擔心！您可以一邊自主運動，一邊點擊下方按鈕手動累計次數，依然能獲得完整的金幣與經驗值獎勵。
          </p>
          <Button
            variant="primary"
            onClick={() => {
              onRepDetected();
            }}
            className="w-full py-5 px-8 text-xl animate-pulse"
          >
            我完成了一次動作！(點擊計數)
          </Button>
        </div>
      )}
    </div>
  );
}
