"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Webcam from 'react-webcam'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap, Play, Loader2, ArrowLeft, Share2, Video, Camera, Volume2, VolumeX } from 'lucide-react'
import { toast } from "sonner"
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { FilesetResolver, HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision"
import { saveScore } from '@/lib/scores'
import { Stage } from '@/lib/stages'
import { GestureBuffer, recognizeDynamicGesture } from '@/lib/gesture-recognizer'

// Types
type Tile = {
    id: string
    char: string // Full word
    lane: number // 0, 1, 2
    y: number
    speed: number
    isHit: boolean
    isMissed: boolean
}

const LANES = [20, 50, 80] // X positions (%)
const HIT_ZONE_Y = 85

const WORD_TO_FOLDER: Record<string, string> = {
    "PLAY": "Play_Noun",
    "HELP": "Help_Verb",
    // Default fallback will be Title Case (e.g. "LOVE" -> "Love")
}

type ActionGameProps = {
    stage: Stage
    onBack: () => void
}

export default function ActionGame({ stage, onBack }: ActionGameProps) {
    const [gameActive, setGameActive] = useState(false)
    const [gameOver, setGameOver] = useState(false)
    const [gameWon, setGameWon] = useState(false)
    const [score, setScore] = useState(0)
    const [totalHits, setTotalHits] = useState(0)
    const [totalMisses, setTotalMisses] = useState(0)
    const [streak, setStreak] = useState(0)
    const [tiles, setTiles] = useState<Tile[]>([])
    const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0)
    const [currentPhrase, setCurrentPhrase] = useState(stage.phrases[0])
    const [isProcessingVideo, setIsProcessingVideo] = useState(false)
    const [countdown, setCountdown] = useState<number | null>(null)
    const [isModelLoading, setIsModelLoading] = useState(true)
    const [detectedAction, setDetectedAction] = useState<string>("NONE")

    // Recording State
    const [isRecordingEnabled, setIsRecordingEnabled] = useState(false)
    const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const recordedChunksRef = useRef<Blob[]>([])

    // Audio State
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const hitAudioRef = useRef<HTMLAudioElement | null>(null)
    const clearedAudioRef = useRef<HTMLAudioElement | null>(null)
    const [isMusicMuted, setIsMusicMuted] = useState<boolean>(() => {
        try {
            const v = localStorage.getItem('signstream-muted')
            return v === 'true'
        } catch (e) {
            return false
        }
    })
    const [musicVolume, setMusicVolume] = useState<number>(() => {
        try {
            const v = localStorage.getItem('signstream-volume')
            return v ? parseFloat(v) : 0.6
        } catch (e) {
            return 0.6
        }
    })

    const playHitSound = async () => {
        try {
            if (hitAudioRef.current) {
                hitAudioRef.current.currentTime = 0
                await hitAudioRef.current.play()
            }
        } catch (e) {
            console.warn('Hit sound play failed:', e)
        }
    }

    const playClearedSound = async () => {
        try {
            if (clearedAudioRef.current) {
                clearedAudioRef.current.currentTime = 0
                await clearedAudioRef.current.play()
            }
        } catch (e) {
            console.warn('Stage cleared sound play failed:', e)
        }
    }

    const rootRef = useRef<HTMLDivElement>(null)
    const gameLoopRef = useRef<number>(0)
    const lastTimeRef = useRef<number>(0)
    const spawnTimerRef = useRef<number>(0)
    const containerRef = useRef<HTMLDivElement>(null)

    const webcamRef = useRef<Webcam>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const handLandmarkerRef = useRef<HandLandmarker | null>(null)

    // Dynamic Gesture Buffer
    const gestureBufferRef = useRef<GestureBuffer>(new GestureBuffer(30));

    // Initialize MediaPipe Hand
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
                    numHands: 2
                });
                handLandmarkerRef.current = handLandmarker;
                setIsModelLoading(false);
            } catch (error) {
                console.error("Error loading Hand model:", error);
            }
        };
        loadModel();
    }, []);

    // Hand Tracking Loop
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

                if (results.landmarks) {
                    for (const landmarks of results.landmarks) {
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00f3ff", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#ff00ff", lineWidth: 1, radius: 3 });
                    }

                    // Dynamic Recognition (Pass ALL hands to buffer)
                    if (results.landmarks.length > 0) {
                        gestureBufferRef.current.add(results.landmarks);
                        const dynamic = recognizeDynamicGesture(gestureBufferRef.current);
                        if (dynamic) {
                            setDetectedAction(dynamic);
                        }
                    }
                }
                if (results.landmarks.length === 0) {
                    // setDetectedAction("NONE"); // Optional: clear immediately
                }
            }
        }
        requestAnimationFrame(predictWebcam);
    }, []);

    useEffect(() => {
        if (!isModelLoading) predictWebcam();
    }, [isModelLoading, predictWebcam]);

    // Audio Sync Effects
    useEffect(() => {
        try {
            localStorage.setItem('signstream-muted', String(isMusicMuted))
        } catch (e) { }
        if (audioRef.current) {
            audioRef.current.muted = isMusicMuted
        }
    }, [isMusicMuted])

    useEffect(() => {
        try {
            localStorage.setItem('signstream-volume', String(musicVolume))
        } catch (e) { }
        if (audioRef.current) {
            audioRef.current.volume = musicVolume
        }
    }, [musicVolume])

    // Pause audio on game over
    useEffect(() => {
        if (gameOver) {
            try {
                if (audioRef.current) {
                    audioRef.current.pause()
                }
            } catch (e) { }
        }
    }, [gameOver])

    // Fallback: ensure audio restarts if 'loop' isn't honored
    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return

        const onEnded = () => {
            try {
                audio.currentTime = 0
                void audio.play()
            } catch (e) {
                console.warn('Failed to restart audio on ended:', e)
            }
        }

        audio.addEventListener('ended', onEnded)
        return () => {
            audio.removeEventListener('ended', onEnded)
        }
    }, [])

    // Recording Functions
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
        a.download = `signstream-action-stage-${stage.id}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // 2. Copy Caption
        const text = `I just crushed Stage ${stage.id} (Action Mode) in SignStream with a score of ${score.toLocaleString()}! 🤟 #SignStream #ASL #Gaming`;
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

    // Game Loop
    const updateGame = useCallback((time: number) => {
        if (!lastTimeRef.current) lastTimeRef.current = time
        const deltaTime = time - lastTimeRef.current
        lastTimeRef.current = time

        if (gameOver) return;

        spawnTimerRef.current += deltaTime

        // Adaptive Spawn Rate (Faster)
        const baseSpawnRate = 1000 / stage.speedMultiplier;
        const spawnRate = Math.max(500, baseSpawnRate - (streak * 50));

        if (spawnTimerRef.current > spawnRate && tiles.length === 0) {
            spawnTimerRef.current = 0

            // Spawn current phrase as WHOLE WORD
            const newTile: Tile = {
                id: Math.random().toString(36).substr(2, 9),
                char: currentPhrase, // Full word
                lane: 1, // Center lane
                y: -20,
                speed: 0.04 * stage.speedMultiplier + (streak * 0.002), // Slightly faster tile speed too
                isHit: false,
                isMissed: false
            }
            setTiles([newTile])
        }

        setTiles(prev => {
            return prev.map(tile => {
                if (tile.isHit || tile.isMissed) return tile
                const newY = tile.y + (tile.speed * deltaTime)
                if (newY > 100 && !tile.isMissed) {
                    setStreak(0)
                    setTotalMisses(m => m + 1)
                    return { ...tile, y: newY, isMissed: true }
                }
                return { ...tile, y: newY }
            }).filter(tile => tile.y < 110)
        })

        // Check Phrase Progression
        const activeTiles = tiles.filter(t => !t.isHit && !t.isMissed);
        if (activeTiles.length === 0 && tiles.length > 0 && tiles.every(t => t.isHit || t.isMissed)) {
            // Move to next phrase
            const nextIdx = currentPhraseIndex + 1;
            if (nextIdx < stage.phrases.length) {
                setCurrentPhraseIndex(nextIdx);
                setCurrentPhrase(stage.phrases[nextIdx]);
                setTiles([]); // Clear
            } else {
                setGameActive(false);
                setGameOver(true);
                setGameWon(true);
                saveScore(stage.id.toString(), score);
                void playClearedSound();

                // Save local progress
                try {
                    const unlocked = JSON.parse(localStorage.getItem('unlockedStages') || '[]');
                    if (!unlocked.includes(stage.id)) {
                        unlocked.push(stage.id);
                        localStorage.setItem('unlockedStages', JSON.stringify(unlocked));
                    }
                } catch (e) {
                    console.error("Failed to save local progress", e);
                }
            }
        }

        gameLoopRef.current = requestAnimationFrame(updateGame)
    }, [tiles, currentPhrase, currentPhraseIndex, stage, gameOver, score, streak])

    // Hit Check
    useEffect(() => {
        if (!gameActive || detectedAction === "NONE") return;

        setTiles(prev => {
            const targetIndex = prev.findIndex(t => !t.isHit && !t.isMissed);
            if (targetIndex !== -1) {
                const tile = prev[targetIndex];
                if (tile.char === detectedAction) {
                    const newTiles = [...prev];
                    newTiles[targetIndex] = { ...tile, isHit: true };
                    setScore(s => s + 500 + (streak * 50));
                    setStreak(s => s + 1);
                    setTotalHits(h => h + 1);
                    void playHitSound();
                    return newTiles;
                }
            }
            return prev;
        })

        // Auto-clear detected action after hit to prevent double counting?
        // Or rely on the fact that the tile is marked hit.
        // But if we have multiple tiles (unlikely in this mode), it might hit next.
        // Let's clear it after a short delay or just let it be.
        const timer = setTimeout(() => setDetectedAction("NONE"), 500);
        return () => clearTimeout(timer);

    }, [detectedAction, gameActive])

    // Start Game
    const startGame = async () => {
        setScore(0)
        setStreak(0)
        setTotalHits(0)
        setTotalMisses(0)
        setTiles([])
        setCountdown(3)
        setCurrentPhraseIndex(0)
        setCurrentPhrase(stage.phrases[0])
        setGameOver(false)
        setGameWon(false)
        setRecordingUrl(null)
        setGameActive(false)

        if (isRecordingEnabled) {
            await startRecording();
        }

        // Start background music
        try {
            if (audioRef.current) {
                audioRef.current.currentTime = 0
                audioRef.current.volume = musicVolume
                audioRef.current.muted = isMusicMuted
                await audioRef.current.play()
            }
        } catch (e) {
            console.warn('Background audio play failed:', e)
        }

        // Reset spawn timer to trigger immediate spawn when game starts
        spawnTimerRef.current = 2000;

        let count = 3
        const timer = setInterval(() => {
            count--
            if (count < 0) {
                clearInterval(timer)
                setCountdown(null)
                setGameActive(true)
            } else {
                setCountdown(count)
            }
        }, 1000)
    }

    // Timer Loop
    useEffect(() => {
        if (gameActive && !countdown) {
            lastTimeRef.current = performance.now()
            gameLoopRef.current = requestAnimationFrame(updateGame)
        }
        return () => cancelAnimationFrame(gameLoopRef.current)
    }, [gameActive, countdown, updateGame])

    const handleBack = () => {
        try {
            if (audioRef.current) {
                audioRef.current.pause()
                audioRef.current.currentTime = 0
            }
        } catch (e) { }
        onBack()
    }

    return (
        <div ref={rootRef} className="relative w-full h-screen max-w-md mx-auto bg-black overflow-hidden flex flex-col font-sans select-none">
            {/* Webcam & Overlay */}
            <div className="absolute inset-0 z-0">
                <Webcam
                    ref={webcamRef}
                    audio={false}
                    className="w-full h-full object-cover"
                    mirrored
                    videoConstraints={{ facingMode: "user" }}
                />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80" />
            </div>

            {/* HUD */}
            <div className="relative z-10 p-4 flex justify-between items-start">
                <Button variant="ghost" size="icon" onClick={handleBack} className="text-white hover:text-neon-blue z-20">
                    <ArrowLeft />
                </Button>

                {/* Center Score - Absolutely positioned */}
                <div className="absolute left-1/2 top-4 -translate-x-1/2 flex flex-col items-center z-10 pointer-events-none">
                    <div className="text-4xl font-black text-white">{score}</div>
                    <div className="text-xs text-neon-blue font-bold">ACTION POINTS</div>
                </div>

                {/* Audio Controls */}
                <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-2 py-1 rounded-full border border-white/20 z-20">
                    <button
                        onClick={() => setIsMusicMuted(m => { const next = !m; try { localStorage.setItem('signstream-muted', String(next)) } catch (e) { }; return next })}
                        aria-label={isMusicMuted ? 'Unmute music' : 'Mute music'}
                        className="text-white hover:text-neon-blue"
                    >
                        {isMusicMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <input
                        aria-label="Music volume"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={musicVolume}
                        onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                        className="w-16"
                    />
                </div>
            </div>

            {/* Game Area */}
            <div className="relative flex-1 z-10 flex flex-col items-center justify-center">
                {/* Current Action Prompt */}
                {gameActive && tiles.map(tile => !tile.isHit && (
                    <motion.div
                        key={tile.id}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{
                            scale: tile.isMissed ? 0.5 : 1,
                            opacity: 1,
                            y: tile.y * 5 // Move down
                        }}
                        className={cn(
                            "bg-black/80 border-4 rounded-3xl p-8 flex flex-col items-center gap-4 backdrop-blur-md shadow-2xl",
                            tile.isMissed ? "border-red-500" : "border-neon-blue"
                        )}
                    >
                        <div className="text-6xl font-black text-white tracking-widest mb-2">{tile.char}</div>

                        {/* Action Sign GIF */}
                        <div className="w-32 h-32 bg-white/10 rounded-xl overflow-hidden mb-2 relative">
                            <img
                                src={`/action_signs/${WORD_TO_FOLDER[tile.char] || tile.char.charAt(0).toUpperCase() + tile.char.slice(1).toLowerCase()}/demo.gif`}
                                alt={tile.char}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        </div>

                        <div className="text-xl text-neon-pink font-bold animate-pulse">
                            {tile.char === "YES" && "🤙↕️ NOD 'Y'!"}
                            {tile.char === "NO" && "🤏 TAP!"}
                            {tile.char === "HELP" && "✊✋⬆️ LIFT!"}
                            {tile.char === "TIME" && "👆⌚️ TAP WRIST!"}
                            {tile.char === "LOVE" && "❤️ CROSS ARMS!"}
                            {tile.char === "PLAY" && "🤙🤙 SHAKE Ys!"}
                            {tile.char === "HOUSE" && "🏠 ROOF SHAPE!"}
                        </div>
                    </motion.div>
                ))}

                {/* Feedback */}
                {detectedAction !== "NONE" && (
                    <div className="absolute bottom-32 text-center">
                        <div className="text-sm text-gray-400 mb-1">DETECTED</div>
                        <div className="text-4xl font-bold text-green-500">{detectedAction}</div>
                    </div>
                )}
            </div>

            {/* Start Overlay */}
            {!gameActive && !countdown && !gameOver && (
                <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                    <h1 className="text-5xl font-black text-white mb-2">ACTION MODE</h1>
                    <p className="text-gray-400 mb-8 text-lg">Use dynamic hand signs!</p>

                    {isModelLoading ? (
                        <div className="flex flex-col items-center gap-4">
                            <Loader2 className="w-8 h-8 text-neon-blue animate-spin" />
                            <p className="text-white">Loading AI Model...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4 items-center">
                            <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full">
                                <Switch
                                    checked={isRecordingEnabled}
                                    onCheckedChange={setIsRecordingEnabled}
                                    className="data-[state=checked]:bg-red-500"
                                />
                                <span className="text-white font-bold">Record Gameplay</span>
                            </div>

                            <Button
                                onClick={startGame}
                                className="bg-neon-blue hover:bg-cyan-400 text-black font-bold text-xl px-12 py-6 rounded-full"
                            >
                                <Play className="mr-2 fill-current" /> START
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* Countdown */}
            {countdown !== null && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="text-9xl font-black text-white">{countdown === 0 ? "GO!" : countdown}</div>
                </div>
            )}

            {/* Game Over */}
            {gameOver && (
                <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                    <h1 className="text-5xl font-black text-white mb-4">{gameWon ? "CLEARED!" : "FAILED"}</h1>
                    <div className="text-4xl font-bold text-neon-blue mb-4">{score}</div>

                    <div className="flex justify-center items-center gap-4 mb-8 text-white/80">
                        <div className="flex flex-col items-center">
                            <span className="text-sm uppercase tracking-wider">Accuracy</span>
                            <span className="text-2xl font-bold text-green-400">
                                {totalHits + totalMisses > 0
                                    ? Math.round((totalHits / (totalHits + totalMisses)) * 100)
                                    : 0}%
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
                            <Button onClick={() => shareToSocial('tiktok')} className="bg-black hover:bg-gray-900 text-white border border-gray-800">
                                <Video className="mr-2 w-4 h-4" /> Save & TikTok
                            </Button>
                            <Button onClick={() => shareToSocial('instagram')} className="bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90 text-white border-none">
                                <Camera className="mr-2 w-4 h-4" /> Save & Insta
                            </Button>
                        </div>
                    ) : null}

                    <Button onClick={handleBack} className="bg-white text-black font-bold px-8 py-4 rounded-full">
                        BACK TO MENU
                    </Button>
                </div>
            )}

            {/* Audio Elements */}
            <audio
                ref={audioRef}
                src="/music/background.mp3"
                loop
                preload="auto"
                style={{ display: 'none' }}
            />
            <audio
                ref={hitAudioRef}
                src="/sfx/hit.wav"
                preload="auto"
                style={{ display: 'none' }}
            />
            <audio
                ref={clearedAudioRef}
                src="/sfx/stage-cleared.wav"
                preload="auto"
                style={{ display: 'none' }}
            />
        </div>
    )
}
