"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Webcam from 'react-webcam'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Play, Loader2, Volume2, VolumeX, RefreshCw, Video, Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toast } from "sonner"
import { cn } from '@/lib/utils'
import { FilesetResolver, HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision"
import { recognizeGesture } from '@/lib/gesture-recognizer'

// --- Constants ---
const ANIMAL_EMOJIS: Record<string, string> = {
    "PIG": "🐷",
    "DOG": "🐶",
    "CROW": "🐦",
    "CHICKEN": "🐔"
}

const GESTURE_MAP: Record<string, string> = {
    "S": "PIG",     // Fist
    "B": "DOG",     // Open Palm
    "C": "CROW",    // C Shape
    "W": "CHICKEN"  // 3 Fingers
}

const ANIMALS = ["PIG", "DOG", "CROW", "CHICKEN"];

// 5 Stages of Difficulty
const STAGE_CONFIGS = [
    {
        id: 1,
        name: "Stage 1: Pairs",
        bpm: 80, // ~0.35s per beat
        pattern: ["PIG", "PIG", "DOG", "DOG", "CROW", "CROW", "CHICKEN", "CHICKEN"]
    },
    {
        id: 2,
        name: "Stage 2: Singles",
        bpm: 80,
        pattern: ["PIG", "DOG", "CROW", "CHICKEN", "PIG", "DOG", "CROW", "CHICKEN"]
    },
    {
        id: 3,
        name: "Stage 3: Mixed",
        bpm: 80,
        pattern: ["DOG", "PIG", "CHICKEN", "CROW", "DOG", "PIG", "CHICKEN", "CROW"]
    },
    {
        id: 4,
        name: "Stage 4: Mixed",
        bpm: 80,
        pattern: ["CROW", "CHICKEN", "PIG", "DOG", "CHICKEN", "CROW", "DOG", "PIG"]
    },
    {
        id: 5,
        name: "Stage 5: CHAOS",
        bpm: 80,
        pattern: [] // Random generated
    }
]

type SpecialChallengeGameProps = {
    onBack: () => void
}

export default function SpecialChallengeGame({ onBack }: SpecialChallengeGameProps) {
    // --- State ---
    const [currentStageIndex, setCurrentStageIndex] = useState(0)
    const [gameActive, setGameActive] = useState(false)
    const [gameOver, setGameOver] = useState(false)
    const [score, setScore] = useState(0)
    const [combo, setCombo] = useState(0)

    // Grid State
    const [grid, setGrid] = useState<string[]>(STAGE_CONFIGS[0].pattern)
    const [activeSlot, setActiveSlot] = useState<number>(-1) // 0-7
    const [slotStatus, setSlotStatus] = useState<('PENDING' | 'HIT' | 'MISS')[]>(new Array(8).fill('PENDING'))

    // Detection
    const [detectedGesture, setDetectedGesture] = useState<string>("NONE")
    const [isModelLoading, setIsModelLoading] = useState(true)

    // Audio
    const [isMuted, setIsMuted] = useState(false)
    const bgmRef = useRef<HTMLAudioElement | null>(null)
    const hitSfxRef = useRef<HTMLAudioElement | null>(null)
    const missSfxRef = useRef<HTMLAudioElement | null>(null)

    // Recording State
    const [isRecordingEnabled, setIsRecordingEnabled] = useState(false)
    const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
    const [isProcessingVideo, setIsProcessingVideo] = useState(false)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const recordedChunksRef = useRef<Blob[]>([])
    const rootRef = useRef<HTMLDivElement>(null)

    // Refs
    const webcamRef = useRef<Webcam>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const handLandmarkerRef = useRef<HandLandmarker | null>(null)
    const requestRef = useRef<number>(0)
    const beatTimerRef = useRef<NodeJS.Timeout | null>(null)
    const stageIndexRef = useRef<number>(0)

    // --- Initialization ---
    useEffect(() => {
        const loadModel = async () => {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
                );
                const handLandmarker = await HandLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                        delegate: "GPU"
                    },
                    runningMode: "VIDEO",
                    numHands: 1 // Only need 1 hand for this
                });
                handLandmarkerRef.current = handLandmarker;
                setIsModelLoading(false);
            } catch (error) {
                console.error("Error loading Hand model:", error);
            }
        };
        loadModel();
    }, []);

    // --- Hand Tracking Loop ---
    const predictWebcam = useCallback(() => {
        if (!handLandmarkerRef.current || !webcamRef.current?.video || !canvasRef.current) return;

        const video = webcamRef.current.video;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        if (video.readyState === 4) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const startTimeMs = performance.now();
            const results = handLandmarkerRef.current.detectForVideo(video, startTimeMs);

            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                let detected = "NONE";

                if (results.landmarks && results.landmarks.length > 0) {
                    const landmarks = results.landmarks[0]; // Just take first hand
                    const drawingUtils = new DrawingUtils(ctx);
                    drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00f3ff", lineWidth: 2 });
                    drawingUtils.drawLandmarks(landmarks, { color: "#ff00ff", lineWidth: 1, radius: 3 });

                    const gesture = recognizeGesture(landmarks);
                    const animal = GESTURE_MAP[gesture];
                    if (animal) detected = animal;
                }
                setDetectedGesture(detected);
            }
        }
        requestRef.current = requestAnimationFrame(predictWebcam);
    }, []);

    useEffect(() => {
        if (!isModelLoading) predictWebcam();
        return () => cancelAnimationFrame(requestRef.current);
    }, [isModelLoading, predictWebcam]);

    // --- Recording Logic ---
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    mediaSource: 'tab',
                    preferCurrentTab: true
                } as any,
                audio: true, // Capture audio too
                preferCurrentTab: true
            } as any);

            // Region Capture (Auto-Crop)
            if (rootRef.current && (window as any).CropTarget) {
                try {
                    const cropTarget = await (window as any).CropTarget.fromElement(rootRef.current);
                    const [track] = stream.getVideoTracks();
                    if ((track as any).cropTo) {
                        await (track as any).cropTo(cropTarget);
                    }
                } catch (cropErr) {
                    console.warn("Region Capture failed, falling back to full tab:", cropErr);
                }
            }

            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
            mediaRecorderRef.current = mediaRecorder;
            recordedChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                setRecordingUrl(url);
                setIsProcessingVideo(false);
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
        } catch (err) {
            console.error("Error starting recording:", err);
            setIsRecordingEnabled(false);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    const shareToSocial = (platform: 'tiktok' | 'instagram') => {
        if (!recordingUrl) return;

        // 1. Download Video
        const a = document.createElement('a');
        a.href = recordingUrl;
        a.download = `pig-dog-crow-chicken-challenge.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // 2. Copy Caption
        const text = `I just crushed the Pig Dog Crow Chicken Challenge with a score of ${score.toLocaleString()}! 🐷🐶🐦🐔 #SignStream #RhythmGame`;
        navigator.clipboard.writeText(text);

        // 3. Open Platform
        const url = platform === 'tiktok' ? 'https://www.tiktok.com/upload' : 'https://www.instagram.com/';
        window.open(url, '_blank');

        toast.success(`Video downloaded! Caption copied!`, {
            description: `Opening ${platform === 'tiktok' ? 'TikTok' : 'Instagram'}...`
        });
    }

    // Stop recording on unmount
    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
        }
    }, [])

    // Stop recording on Game Over
    useEffect(() => {
        if (gameOver) {
            if (isRecordingEnabled) setIsProcessingVideo(true);
            const timer = setTimeout(() => {
                if (isRecordingEnabled) stopRecording();
            }, 1000); // Short delay to capture end screen
            return () => clearTimeout(timer);
        }
    }, [gameOver, isRecordingEnabled]);

    // --- Game Logic ---

    // Helper to set up stage data (Pattern)
    const setupStageData = (index: number) => {
        const config = STAGE_CONFIGS[index];
        let pattern = config.pattern;

        // Generate random pattern for Stage 5
        if (index === 4) {
            pattern = Array(8).fill(null).map(() => ANIMALS[Math.floor(Math.random() * ANIMALS.length)]);
        }

        setGrid(pattern);
        setSlotStatus(new Array(8).fill('PENDING'));
        setActiveSlot(-1);
        setCurrentStageIndex(index);
        stageIndexRef.current = index;
    };

    // Check Hit on Beat
    useEffect(() => {
        if (!gameActive || activeSlot === -1) return;

        const targetAnimal = grid[activeSlot];
        const currentStatus = slotStatus[activeSlot];

        if (currentStatus === 'PENDING') {
            if (detectedGesture === targetAnimal) {
                // HIT!
                setSlotStatus(prev => {
                    const newStatus = [...prev];
                    newStatus[activeSlot] = 'HIT';
                    return newStatus;
                });
                setScore(s => s + 100 + (combo * 10));
                setCombo(c => c + 1);

                if (hitSfxRef.current) {
                    hitSfxRef.current.currentTime = 0;
                    hitSfxRef.current.play().catch(() => { });
                }
            }
        }
    }, [detectedGesture, activeSlot, gameActive, grid, slotStatus, combo]);

    // Game Loop & Beat Logic
    useEffect(() => {
        if (!gameActive) return;

        // Constant BPM for all stages now
        const beatInterval = 60000 / 171;

        // Clear existing
        if (beatTimerRef.current) clearInterval(beatTimerRef.current);

        // Determine start beat
        // Always start with count-in for the very first stage
        // But since we only run this effect ONCE at start, we can assume count-in.
        let currentBeat = -8;
        let loopsCompleted = 0;

        const runInterval = () => {
            beatTimerRef.current = setInterval(() => {
                // 1. Check Miss for the beat that just ended
                if (currentBeat >= 0) {
                    setSlotStatus(prev => {
                        const newStatus = [...prev];
                        if (newStatus[currentBeat % 8] === 'PENDING') { // Use modulo for currentBeat to check correct slot
                            newStatus[currentBeat % 8] = 'MISS';
                            setCombo(0);
                            if (missSfxRef.current) {
                                missSfxRef.current.currentTime = 0;
                                missSfxRef.current.play().catch(() => { });
                            }
                        }
                        return newStatus;
                    });
                }

                // 2. Advance to the next beat
                currentBeat++;

                // 3. Handle Count-in Phase
                if (currentBeat < 0) {
                    if (missSfxRef.current) {
                        // Silent tick
                    }
                    setActiveSlot(-1);
                    return;
                }

                // 4. Game Phase Logic
                const normalizedCurrentBeat = currentBeat % 8;

                // Check for Loop Completion (Stage Advance)
                if (normalizedCurrentBeat === 0 && currentBeat > 0) {
                    loopsCompleted++;
                    if (loopsCompleted >= 1) {
                        // Advance Stage
                        const nextStageIdx = stageIndexRef.current + 1;
                        if (nextStageIdx < STAGE_CONFIGS.length) {
                            // Stop current beat
                            if (beatTimerRef.current) clearInterval(beatTimerRef.current);
                            setActiveSlot(-1);

                            // Dynamic Delay: 2500ms for Stage 5 (index 4), 3000ms for others
                            const delay = nextStageIdx === 4 ? 2500 : 3000;

                            // Wait then start next stage
                            setTimeout(() => {
                                setupStageData(nextStageIdx);
                                loopsCompleted = 0;
                                currentBeat = -1; // Start immediately (next tick is 0)
                                runInterval();
                            }, delay);

                            return;
                        } else {
                            // Game Over (Win)
                            setGameOver(true);
                            setGameActive(false);
                            if (beatTimerRef.current) clearInterval(beatTimerRef.current);

                            // Stop music after 3 seconds
                            setTimeout(() => {
                                if (bgmRef.current) {
                                    bgmRef.current.pause();
                                    bgmRef.current.currentTime = 0;
                                }
                            }, 3000);

                            return;
                        }
                    }
                }

                // Set New Active Slot
                setActiveSlot(normalizedCurrentBeat);
                setSlotStatus(prev => {
                    const ns = [...prev];
                    ns[normalizedCurrentBeat] = 'PENDING';
                    return ns;
                });

            }, beatInterval);
        };

        // Start Music and Delay ONLY if we are at the beginning
        if (stageIndexRef.current === 0) {
            if (bgmRef.current) {
                bgmRef.current.currentTime = 0;
                bgmRef.current.playbackRate = 1.0;
                bgmRef.current.play().catch(() => { });
            }
            setTimeout(runInterval, 3000);
        } else {
            // Should not happen if we don't re-run effect, but for safety:
            runInterval();
        }

        return () => {
            if (beatTimerRef.current) clearInterval(beatTimerRef.current);
        };
    }, [gameActive]); // Only depend on gameActive, NOT currentStageIndex

    const handleStart = async () => {
        setScore(0);
        setCombo(0);
        setRecordingUrl(null);
        setGameOver(false);

        if (isRecordingEnabled) {
            await startRecording();
        }

        setupStageData(0); // Set Stage 1
        setGameActive(true); // Triggers useEffect
    };

    const handleBack = () => {
        if (bgmRef.current) {
            bgmRef.current.pause();
            bgmRef.current.currentTime = 0;
        }
        if (beatTimerRef.current) clearInterval(beatTimerRef.current);
        onBack();
    };

    return (
        <div ref={rootRef} className="relative w-full h-screen max-w-md mx-auto bg-black overflow-hidden flex flex-col font-sans select-none">
            {/* Webcam Layer */}
            <div className="absolute inset-0 z-0">
                <Webcam
                    ref={webcamRef}
                    audio={false}
                    className="w-full h-full object-cover opacity-30"
                    mirrored
                    videoConstraints={{ facingMode: "user" }}
                />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" />
            </div>

            {/* HUD */}
            <div className="relative z-10 p-4 flex justify-between items-start">
                <Button variant="ghost" size="icon" onClick={handleBack} className="text-white hover:text-neon-blue z-20">
                    <ArrowLeft />
                </Button>

                <div className="flex flex-col items-center">
                    <div className="text-4xl font-black text-white drop-shadow-lg">{score}</div>
                    <div className="text-xs text-neon-pink font-bold">COMBO {combo}</div>
                    <div className="text-lg text-yellow-400 font-black mt-1 uppercase tracking-widest">
                        STAGE {currentStageIndex + 1}/{STAGE_CONFIGS.length}
                    </div>
                    <div className="text-[10px] text-gray-400 font-bold">{STAGE_CONFIGS[currentStageIndex].name.split(':')[1]}</div>
                </div>

                <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-2 py-1 rounded-full border border-white/20 z-20">
                    <button onClick={() => setIsMuted(!isMuted)} className="text-white">
                        {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                </div>
            </div>

            {/* Grid Game Area - Top Positioned */}
            <div className="relative z-10 w-full flex justify-center pt-20 px-4">
                <div className="grid grid-rows-2 grid-cols-4 gap-2 w-full max-w-lg">
                    {grid.map((animal, index) => {
                        const isActive = index === activeSlot;
                        const status = slotStatus[index];

                        return (
                            <motion.div
                                key={index}
                                className={cn(
                                    "aspect-square rounded-xl flex items-center justify-center text-4xl border-2 transition-all duration-100",
                                    isActive ? "scale-110 border-neon-blue bg-neon-blue/20 shadow-[0_0_20px_rgba(0,243,255,0.5)] z-20" : "border-white/10 bg-black/40",
                                    status === 'HIT' && !isActive ? "border-green-500 bg-green-500/20" : "",
                                    status === 'MISS' && !isActive ? "border-red-500 bg-red-500/20" : ""
                                )}
                            >
                                {ANIMAL_EMOJIS[animal]}
                            </motion.div>
                        )
                    })}
                </div>
            </div>

            {/* Feedback - Bottom Center */}
            <div className="absolute bottom-10 left-0 w-full text-center z-20">
                <div className="text-xs text-gray-400 mb-1">DETECTED</div>
                <div className="text-4xl font-bold text-neon-blue h-12">
                    {ANIMAL_EMOJIS[detectedGesture] || detectedGesture}
                </div>
            </div>

            {/* Overlays */}
            {!gameActive && (
                <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-6 text-center">
                    {gameOver ? (
                        // --- RESULT SCREEN ---
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="flex flex-col items-center"
                        >
                            <h1 className="text-4xl font-black text-neon-blue mb-2">CHALLENGE COMPLETE!</h1>
                            <div className="text-6xl font-black text-white mb-4 drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">
                                {score}
                            </div>

                            <div className="flex gap-8 mb-8">
                                <div className="flex flex-col items-center">
                                    <span className="text-gray-400 text-xs font-bold">MAX COMBO</span>
                                    <span className="text-2xl font-bold text-neon-pink">{combo}</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <span className="text-gray-400 text-xs font-bold">GRADE</span>
                                    <span className={cn("text-4xl font-black",
                                        score > 4000 ? "text-yellow-400" :
                                            score > 3000 ? "text-green-400" :
                                                score > 2000 ? "text-blue-400" : "text-gray-400"
                                    )}>
                                        {score > 4000 ? "S" : score > 3000 ? "A" : score > 2000 ? "B" : "C"}
                                    </span>
                                </div>
                            </div>

                            {isProcessingVideo ? (
                                <div className="flex flex-col items-center gap-2 mb-8">
                                    <Loader2 className="w-6 h-6 text-neon-pink animate-spin" />
                                    <span className="text-white text-sm">Processing Recording...</span>
                                </div>
                            ) : recordingUrl ? (
                                <div className="flex gap-4 mb-8">
                                    <Button onClick={() => shareToSocial('tiktok')} className="bg-black hover:bg-gray-900 text-white border border-gray-800 px-6 py-6 h-auto flex flex-col gap-2">
                                        <img src="/TikTok.png" alt="TikTok" className="w-8 h-8 object-contain" />
                                        <span className="text-xs font-bold">Save & Share</span>
                                    </Button>
                                    <Button onClick={() => shareToSocial('instagram')} className="bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90 text-white border-none px-6 py-6 h-auto flex flex-col gap-2">
                                        <img src="/Instagram_icon.png" alt="Instagram" className="w-8 h-8 object-contain" />
                                        <span className="text-xs font-bold">Save & Share</span>
                                    </Button>
                                </div>
                            ) : null}

                            <div className="flex flex-col gap-3 w-full max-w-xs">
                                <Button onClick={handleStart} className="bg-neon-blue hover:bg-blue-600 text-black px-8 py-6 text-xl rounded-full font-black w-full">
                                    PLAY AGAIN
                                </Button>
                                <Button onClick={handleBack} variant="outline" className="border-white/20 text-white hover:bg-white/10 px-8 py-6 text-xl rounded-full font-bold w-full">
                                    BACK TO MENU
                                </Button>
                            </div>
                        </motion.div>
                    ) : (
                        // --- START SCREEN ---
                        <>
                            <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-yellow-500 mb-2">
                                PIG DOG CROW CHICKEN
                            </h1>
                            <p className="text-gray-400 mb-8">Rhythm Challenge</p>

                            <div className="grid grid-cols-2 gap-4 mb-8 text-left text-sm">
                                <div className="flex items-center gap-2 text-white"><span className="text-2xl">🐷</span> = <span className="font-bold text-neon-blue">FIST (S)</span></div>
                                <div className="flex items-center gap-2 text-white"><span className="text-2xl">🐶</span> = <span className="font-bold text-neon-blue">PALM (B)</span></div>
                                <div className="flex items-center gap-2 text-white"><span className="text-2xl">🐦</span> = <span className="font-bold text-neon-blue">C-SHAPE (C)</span></div>
                                <div className="flex items-center gap-2 text-white"><span className="text-2xl">🐔</span> = <span className="font-bold text-neon-blue">3-FINGERS (W)</span></div>
                            </div>

                            {isModelLoading ? (
                                <Loader2 className="animate-spin text-white" />
                            ) : (
                                <div className="flex flex-col gap-4 items-center">
                                    <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full">
                                        <Switch
                                            checked={isRecordingEnabled}
                                            onCheckedChange={setIsRecordingEnabled}
                                            className="data-[state=checked]:bg-neon-pink"
                                        />
                                        <span className="text-white font-bold">Record Run</span>
                                    </div>
                                    <Button onClick={handleStart} className="bg-neon-pink hover:bg-pink-600 text-white px-12 py-6 text-xl rounded-full font-black">
                                        START
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Audio Sources */}
            <audio ref={bgmRef} src="/music/pigdogcrowchicken.mp3" />
            <audio ref={hitSfxRef} src="/sfx/hit.wav" />
            <audio ref={missSfxRef} src="/sfx/miss.wav" />
        </div>
    )
}
