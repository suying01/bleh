"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Webcam from 'react-webcam'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap, Volume2, VolumeX, Eye, Play, Hand, Loader2, ArrowLeft, Share2, ToggleLeft, ToggleRight, Video, Instagram } from 'lucide-react'
import { toast } from "sonner"
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { FilesetResolver, HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision"
import { saveScore } from '@/lib/scores'
import { recognizeGesture, checkOrientation, Gesture, Orientation } from '@/lib/gesture-recognizer'
import { Stage } from '@/lib/stages'

const TikTokIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
)

// Types
type Tile = {
    id: string
    char: string
    lane: number // 0, 1, 2 (Left, Center, Right)
    y: number // 0 to 100 percentage
    speed: number
    isHit: boolean
    isMissed: boolean
}

const LANES = [20, 50, 80] // X positions (%)
const HIT_ZONE_Y = 85
const HIT_ZONE_THRESHOLD = 15 // Increased threshold for easier gameplay

type SignStreamGameProps = {
    stage: Stage
    onBack: () => void
}

export default function SignStreamGame({ stage, onBack }: SignStreamGameProps) {
    const [gameActive, setGameActive] = useState(false)
    const [gameOver, setGameOver] = useState(false)
    const [gameWon, setGameWon] = useState(false)
    const [score, setScore] = useState(0)
    const [streak, setStreak] = useState(0)
    const [tiles, setTiles] = useState<Tile[]>([])
    const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0)
    const [currentPhrase, setCurrentPhrase] = useState(stage.phrases[0])
    const [isProcessingVideo, setIsProcessingVideo] = useState(false)
    const [nextCharIndex, setNextCharIndex] = useState(0)
    const [countdown, setCountdown] = useState<number | null>(null)
    const [isModelLoading, setIsModelLoading] = useState(true)
    const [isWebcamActive, setIsWebcamActive] = useState(true)
    const [detectedGesture, setDetectedGesture] = useState<Gesture>("NONE")
    const [detectedOrientation, setDetectedOrientation] = useState<Orientation>("NONE")
    const [showHints, setShowHints] = useState(true) // Manual toggle

    // Recording State
    const [isRecordingEnabled, setIsRecordingEnabled] = useState(false)
    const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const recordedChunksRef = useRef<Blob[]>([])
    // Audio (background music)
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
            // ignore play errors
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
            // ignore play errors
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

    // Initialize MediaPipe
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
                    numHands: 1
                });
                handLandmarkerRef.current = handLandmarker;
                setIsModelLoading(false);
            } catch (error) {
                console.error("Error loading MediaPipe model:", error);
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
                        // Draw landmarks
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
                            color: "#00f3ff",
                            lineWidth: 2
                        });
                        drawingUtils.drawLandmarks(landmarks, {
                            color: "#ff00ff",
                            lineWidth: 1,
                            radius: 3
                        });

                        // Recognize Gesture
                        const gesture = recognizeGesture(landmarks);
                        const orientation = checkOrientation(landmarks);
                        setDetectedGesture(gesture);
                        setDetectedOrientation(orientation);
                    }
                }
                if (results.landmarks.length === 0) {
                    setDetectedGesture("NONE");
                    setDetectedOrientation("NONE");
                }
            }
        }
        requestAnimationFrame(predictWebcam);
    }, []);

    // Start prediction loop when model is ready
    useEffect(() => {
        if (!isModelLoading) {
            predictWebcam();
        }
    }, [isModelLoading, predictWebcam]);

    // Recording functions
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    mediaSource: 'tab',
                    preferCurrentTab: true
                } as any,
                audio: true,
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
                setIsProcessingVideo(false); // Processing done
                stream.getTracks().forEach(track => track.stop()); // Stop the stream
            };

            mediaRecorder.start();
        } catch (err) {
            console.error("Error starting recording:", err);
            setIsRecordingEnabled(false); // Disable if cancelled/error
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    // Game Loop
    const updateGame = useCallback((time: number) => {
        if (!lastTimeRef.current) lastTimeRef.current = time
        const deltaTime = time - lastTimeRef.current
        lastTimeRef.current = time

        if (gameOver) return;

        // Spawn tiles
        spawnTimerRef.current += deltaTime

        // Adaptive Speed: Increases significantly with Streak + Stage Multiplier
        const baseSpeed = 0.04 * stage.speedMultiplier;
        const currentSpeed = baseSpeed + (streak * 0.002);

        // Adaptive Spawn Rate: Faster as streak increases
        const baseSpawnRate = 1200 / stage.speedMultiplier;
        const streakBonus = streak * 30;
        const spawnRate = Math.max(300, baseSpawnRate - streakBonus);

        // Rapid Flow: If no active tiles, spawn immediately (or very fast)
        const activeTilesCount = tiles.filter(t => !t.isHit && !t.isMissed).length;
        const shouldSpawn = spawnTimerRef.current > spawnRate || (activeTilesCount === 0 && spawnTimerRef.current > 100);

        if (shouldSpawn) {
            spawnTimerRef.current = 0

            // Check if we have more chars in current phrase
            if (nextCharIndex < currentPhrase.length) {
                const char = currentPhrase[nextCharIndex];

                const newTile: Tile = {
                    id: Math.random().toString(36).substr(2, 9),
                    char: char,
                    lane: Math.floor(Math.random() * 3),
                    y: -20, // Start slightly higher to avoid pop-in
                    speed: currentSpeed,
                    isHit: false,
                    isMissed: false
                }
                setTiles(prev => [...prev, newTile])
                setNextCharIndex(prev => prev + 1)
            } else {
                const activeTiles = tiles.filter(t => !t.isHit && !t.isMissed);
                if (activeTiles.length === 0 && nextCharIndex >= currentPhrase.length) {
                    // Move to next phrase
                    const nextIdx = currentPhraseIndex + 1;
                    if (nextIdx < stage.phrases.length) {
                        setCurrentPhraseIndex(nextIdx);
                        setCurrentPhrase(stage.phrases[nextIdx]);
                        setNextCharIndex(0);
                    } else {
                        // Stage Complete!
                        setGameActive(false);
                        setGameOver(true);
                        setGameWon(true);
                        saveScore(stage.id.toString(), score);
                        // Play stage cleared sound
                        void playClearedSound();

                        // Save progress locally for guest/offline support
                        try {
                            const unlocked = JSON.parse(localStorage.getItem('unlockedStages') || '[]');
                            if (!unlocked.includes(stage.id)) {
                                unlocked.push(stage.id);
                                localStorage.setItem('unlockedStages', JSON.stringify(unlocked));
                            }
                        } catch (e) {
                            console.error("Failed to save local progress", e);
                        }

                        // Recording will stop via useEffect after a delay
                    }
                }
            }
        }

        // Update tiles
        setTiles(prev => {
            return prev.map(tile => {
                if (tile.isHit || tile.isMissed) return tile

                const newY = tile.y + (tile.speed * deltaTime)

                // Miss condition
                if (newY > 100 && !tile.isMissed) {
                    setStreak(0)
                    return { ...tile, y: newY, isMissed: true }
                }

                return { ...tile, y: newY }
            }).filter(tile => tile.y < 110) // Cleanup
        })

        gameLoopRef.current = requestAnimationFrame(updateGame)
    }, [streak, nextCharIndex, currentPhrase, currentPhraseIndex, tiles, stage, gameOver, score, isRecordingEnabled])

    // Stop recording and webcam with a delay after game over
    useEffect(() => {
        if (gameOver) {
            if (isRecordingEnabled) setIsProcessingVideo(true); // Start processing UI
            const timer = setTimeout(() => {
                if (isRecordingEnabled) stopRecording();
                setIsWebcamActive(false); // Terminate webcam after recording/delay
            }, 3000); // 3 second delay for reaction
            return () => clearTimeout(timer);
        }
    }, [gameOver, isRecordingEnabled]);

    // Check for hits based on detected gesture
    useEffect(() => {
        if (!gameActive || detectedGesture === "NONE") return;

        setTiles(prev => {
            // Sequential Clearing: We must clear the oldest tile first.
            // Find the first tile that is NOT hit and NOT missed.
            const firstActiveTileIndex = prev.findIndex(t => !t.isHit && !t.isMissed);

            if (firstActiveTileIndex !== -1) {
                const targetTile = prev[firstActiveTileIndex];

                // Check if the gesture matches THIS specific tile
                if (targetTile.char === detectedGesture) {
                    const newTiles = [...prev];
                    newTiles[firstActiveTileIndex] = { ...newTiles[firstActiveTileIndex], isHit: true };
                    setScore(s => s + 100 + (streak * 10));
                    setStreak(s => s + 1);
                    // Play hit sound
                    void playHitSound()
                    return newTiles;
                }
            }
            return prev;
        })
    }, [detectedGesture, gameActive, streak])

    useEffect(() => {
        if (gameActive && !countdown) {
            lastTimeRef.current = performance.now()
            gameLoopRef.current = requestAnimationFrame(updateGame)
        } else {
            cancelAnimationFrame(gameLoopRef.current)
        }
        return () => cancelAnimationFrame(gameLoopRef.current)
    }, [gameActive, countdown, updateGame])

    // Also stop recording if game over (loss) - logic needs to be checked where loss happens
    // Loss happens in setTiles update:
    // if (newY > 100 && !tile.isMissed) ... setStreak(0) ...
    // Wait, loss condition isn't explicit "Game Over" in this code, it's just streak reset?
    // Ah, looking at previous code, there is no "Game Over" on miss, just streak reset.
    // So "Game Over" only happens on Win? Or is there a time limit/lives?
    // The current code only sets gameOver=true on WIN.
    // If we want to support "Game Over" on loss, we'd need to add that.
    // For now, let's assume we only record successful runs or manual stops?
    // Actually, if the user quits (onBack), we should stop recording.

    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
        }
    }, [])

    // Keep audio element properties in sync and persist preferences
    useEffect(() => {
        try {
            localStorage.setItem('signstream-muted', String(isMusicMuted))
        } catch (e) {}
        if (audioRef.current) {
            audioRef.current.muted = isMusicMuted
        }
    }, [isMusicMuted])

    useEffect(() => {
        try {
            localStorage.setItem('signstream-volume', String(musicVolume))
        } catch (e) {}
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
            } catch (e) {}
        }
    }, [gameOver])

    // Fallback: ensure audio restarts if 'loop' isn't honored for some reason
    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return

        const onEnded = () => {
            try {
                // Try to restart playback (fallback)
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

    // Start Game Sequence
    const startGame = async () => {
        setScore(0)
        setStreak(0)
        setTiles([])
        setCountdown(3)
        setCurrentPhraseIndex(0)
        setCurrentPhrase(stage.phrases[0])
        setNextCharIndex(0)
        setGameOver(false)
        setGameWon(false)
        setRecordingUrl(null)
        setIsWebcamActive(true) // Ensure webcam is active for new game

        if (isRecordingEnabled) {
            await startRecording();
        }

        // Start background music (user gesture from START button allows play)
        try {
            if (audioRef.current) {
                audioRef.current.currentTime = 0
                audioRef.current.volume = musicVolume
                audioRef.current.muted = isMusicMuted
                await audioRef.current.play()
            }
        } catch (e) {
            // ignore play errors (autoplay policies) — will remain silent until user toggles
            console.warn('Background audio play failed:', e)
        }

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

    const shareScore = () => {
        const text = `I scored ${score.toLocaleString()} in SignStream Stage ${stage.id}! 🤟 Can you beat me?`;
        navigator.clipboard.writeText(text);
        toast.success("Score copied to clipboard!");
    }

    // Pause/stop audio and then call onBack
    const handleBack = () => {
        try {
            if (audioRef.current) {
                audioRef.current.pause()
                audioRef.current.currentTime = 0
            }
        } catch (e) {}
        onBack()
    }

    const shareToSocial = (platform: 'tiktok' | 'instagram') => {
        if (!recordingUrl) return;

        // 1. Download Video
        const a = document.createElement('a');
        a.href = recordingUrl;
        a.download = `signstream-stage-${stage.id}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // 2. Copy Caption
        const text = `I just crushed Stage ${stage.id} in SignStream with a score of ${score.toLocaleString()}! 🤟 #SignStream #ASL #Gaming`;
        navigator.clipboard.writeText(text);

        // 3. Open Platform
        const url = platform === 'tiktok' ? 'https://www.tiktok.com/upload' : 'https://www.instagram.com/';
        window.open(url, '_blank');

        toast.success(`Video downloaded! Caption copied!`, {
            description: `Opening ${platform === 'tiktok' ? 'TikTok' : 'Instagram'}...`
        });
    }

    return (
        <div ref={rootRef} className="relative w-full h-screen max-w-md mx-auto bg-black overflow-hidden flex flex-col font-sans select-none">
            {/* Background / Webcam */}
            <div className="absolute inset-0 z-0 opacity-50">
                {isWebcamActive && (
                    <Webcam
                        ref={webcamRef}
                        audio={false}
                        className="w-full h-full object-cover"
                        mirrored
                        videoConstraints={{
                            facingMode: "user"
                        }}
                        onUserMediaError={(err) => {
                            console.error("Webcam Error:", err);
                            toast.error("Camera access failed. Ensure HTTPS is used on mobile.");
                        }}
                    />
                )}
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80" />
            </div>

            {/* HUD Top */}
            <div className="relative z-10 p-4 flex justify-between items-start">
                <div className="flex flex-col gap-1">
                    <Button variant="ghost" size="icon" onClick={handleBack} className="text-white hover:text-neon-blue mb-2">
                        <ArrowLeft />
                    </Button>
                    <Badge variant="outline" className="text-neon-blue border-neon-blue bg-black/50 backdrop-blur-md text-lg px-3 py-1">
                        {score.toLocaleString()}
                    </Badge>
                    <div className="flex items-center gap-2 text-neon-pink font-bold animate-pulse">
                        <Zap className="w-4 h-4 fill-current" />
                        <span>{streak}x STREAK</span>
                    </div>
                    <div className="text-xs text-gray-400">{stage.name}</div>
                </div>

                <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-2 py-1 rounded-full border border-white/20">
                        <span className="text-xs text-white">HINTS</span>
                        <Switch
                            checked={showHints}
                            onCheckedChange={setShowHints}
                            className="data-[state=checked]:bg-neon-blue"
                        />
                    </div>

                    {/* Music toggle */}
                    <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-2 py-1 rounded-full border border-white/20">
                        <button
                            onClick={() => setIsMusicMuted(m => { const next = !m; try { localStorage.setItem('signstream-muted', String(next)) } catch(e){}; return next })}
                            aria-label={isMusicMuted ? 'Unmute music' : 'Mute music'}
                            className="text-white hover:text-neon-blue"
                        >
                            {isMusicMuted ? <VolumeX /> : <Volume2 />}
                        </button>
                        <input
                            aria-label="Music volume"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={musicVolume}
                            onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                            className="w-24"
                        />
                    </div>
                </div>
            </div>

            {/* Game Area */}
            <div className="relative flex-1 z-10" ref={containerRef}>
                {/* Lanes */}
                {LANES.map((laneX, i) => (
                    <div key={i} className="absolute top-0 bottom-0 w-px bg-white/10" style={{ left: `${laneX}%` }} />
                ))}

                {/* Hit Zone */}
                <div
                    className="absolute w-full h-16 border-t-2 border-b-2 border-neon-blue/50 bg-neon-blue/10 shadow-[0_0_20px_rgba(0,243,255,0.3)]"
                    style={{ top: `${HIT_ZONE_Y}%` }}
                >
                    <div className="absolute inset-0 flex justify-around items-center opacity-50">
                        {LANES.map((_, i) => (
                            <div key={i} className="w-12 h-12 border-2 border-white/30 rounded-full" />
                        ))}
                    </div>
                </div>

                {/* Falling Tiles */}
                <AnimatePresence>
                    {tiles.map((tile) => (
                        !tile.isHit && (
                            <motion.div
                                key={tile.id}
                                initial={{ y: -50, opacity: 0 }}
                                animate={{
                                    left: `${LANES[tile.lane]}%`,
                                    top: `${tile.y}%`,
                                    opacity: 1,
                                    scale: tile.isMissed ? 0.5 : 1
                                }}
                                exit={{ scale: 1.5, opacity: 0 }}
                                className={cn(
                                    "absolute transform -translate-x-1/2 w-16 h-16 flex flex-col items-center justify-center rounded-xl border-2 font-bold text-xl shadow-lg transition-colors overflow-hidden",
                                    tile.isMissed ? "bg-red-500/50 border-red-500 text-white" : "bg-black/80 border-neon-pink text-neon-pink shadow-[0_0_10px_#ff00ff]"
                                )}
                            >
                                {showHints && (
                                    <img
                                        src={`/signs/${tile.char}.png`}
                                        alt={tile.char}
                                        className="w-10 h-10 object-contain invert"
                                    />
                                )}
                                <span className="text-sm">{tile.char}</span>
                            </motion.div>
                        )
                    ))}
                </AnimatePresence>



                {/* Hit Effects */}
                {tiles.filter(t => t.isHit).map((tile) => (
                    <motion.div
                        key={`effect-${tile.id}`}
                        initial={{ left: `${LANES[tile.lane]}%`, top: `${tile.y}%`, opacity: 1, scale: 1 }}
                        animate={{ scale: 2, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="absolute transform -translate-x-1/2 text-neon-blue font-black text-2xl z-20"
                    >
                        PERFECT!
                    </motion.div>
                ))}
            </div>

            {/* Start Overlay */}
            {!gameActive && !countdown && !gameOver && (
                <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                    <h1 className="text-4xl font-black text-white mb-2">{stage.name}</h1>
                    <p className="text-gray-400 mb-8 text-lg">{stage.description}</p>

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
                                className="bg-neon-blue hover:bg-cyan-400 text-black font-bold text-xl px-8 py-6 rounded-full shadow-[0_0_20px_rgba(0,243,255,0.5)] transition-transform hover:scale-105"
                            >
                                <Play className="mr-2 fill-current" /> START STAGE
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* Game Over / Win Overlay */}
            {gameOver && (
                <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                    <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-neon-pink mb-4 drop-shadow-lg">
                        {gameWon ? "STAGE CLEARED!" : "GAME OVER"}
                    </h1>
                    <div className="text-6xl font-bold text-white mb-8">
                        {score.toLocaleString()}
                    </div>

                    <div className="flex flex-col gap-4 w-full max-w-xs">
                        {isProcessingVideo ? (
                            <Button disabled className="w-full bg-gray-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2">
                                <Loader2 className="w-5 h-5 animate-spin" /> Processing Video...
                            </Button>
                        ) : recordingUrl ? (
                            <>
                                <Button
                                    onClick={() => shareToSocial('tiktok')}
                                    className="w-full bg-black hover:bg-gray-900 text-white border border-gray-700 font-bold py-4 rounded-xl flex items-center justify-center gap-2"
                                >
                                    <Video className="w-5 h-5" /> Share on TikTok
                                </Button>
                                <Button
                                    onClick={() => shareToSocial('instagram')}
                                    className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2"
                                >
                                    <Share2 className="w-5 h-5" /> Share on Instagram
                                </Button>
                            </>
                        ) : null}

                        <Button
                            onClick={handleBack}
                            className="bg-neon-blue hover:bg-cyan-400 text-black font-bold py-4 rounded-xl"
                        >
                            BACK TO MENU
                        </Button>
                    </div>
                </div>
            )}

            {/* Countdown Overlay */}
            {countdown !== null && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
                    <motion.div
                        key={countdown}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1.5, opacity: 1 }}
                        exit={{ scale: 2, opacity: 0 }}
                        className="text-8xl font-black text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]"
                    >
                        {countdown === 0 ? "SIGN!" : countdown}
                    </motion.div>
                </div>
            )}

            {/* Bottom Controls */}
            <div className="relative z-20 p-6 pb-8 bg-gradient-to-t from-black via-black/80 to-transparent">
                <div className="text-center mb-4">
                    <p className="text-sm text-gray-400 uppercase tracking-widest mb-1">Current Phrase</p>
                    <div className="flex justify-center gap-1">
                        {currentPhrase.split('').map((char, i) => (
                            <span key={i} className={cn(
                                "text-2xl font-bold transition-colors",
                                i < nextCharIndex ? "text-neon-blue" : "text-gray-600"
                            )}>
                                {char}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="flex justify-center items-center gap-4">
                    <div className="text-white/50 text-sm">
                        Detected: <span className="text-neon-pink font-bold text-xl">{detectedGesture}</span>
                    </div>
                </div>
            </div>

            {/* Background audio element (place your file at public/music/background.mp3) */}
            <audio
                ref={audioRef}
                src="/music/background.mp3"
                loop
                preload="auto"
                style={{ display: 'none' }}
            />
            {/* Hit sound (place at public/sfx/hit.wav) */}
            <audio
                ref={hitAudioRef}
                src="/sfx/hit.wav"
                preload="auto"
                style={{ display: 'none' }}
            />
            {/* Stage cleared sound (place at public/sfx/stage-cleared.wav) */}
            <audio
                ref={clearedAudioRef}
                src="/sfx/stage-cleared.wav"
                preload="auto"
                style={{ display: 'none' }}
            />
        </div>
    )
}
