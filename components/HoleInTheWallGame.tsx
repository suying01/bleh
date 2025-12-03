"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Webcam from 'react-webcam'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Timer, Trophy, Zap, Loader2 } from 'lucide-react'
import { toast } from "sonner"
import { Button } from '@/components/ui/button'
import { FilesetResolver, HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision"
import { recognizeGesture, checkOrientation, Gesture, Orientation } from '@/lib/gesture-recognizer'
import { cn } from '@/lib/utils'

const GAME_DURATION = 60
const WALL_SPEED_BASE = 0.005
const WALL_SPEED_MAX = 0.015

export default function HoleInTheWallGame({ onBack }: { onBack: () => void }) {
    const [gameActive, setGameActive] = useState(false)
    const [gameOver, setGameOver] = useState(false)
    const [score, setScore] = useState(0)
    const [timeLeft, setTimeLeft] = useState(GAME_DURATION)
    const [wallScale, setWallScale] = useState(0) // 0 (far) to 1 (hit)
    const [targetSign, setTargetSign] = useState<string>("A")
    const [isBouncing, setIsBouncing] = useState(false)

    // MediaPipe & Webcam
    const [isModelLoading, setIsModelLoading] = useState(true)
    const [detectedGesture, setDetectedGesture] = useState<Gesture>("NONE")
    const webcamRef = useRef<Webcam>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const handLandmarkerRef = useRef<HandLandmarker | null>(null)

    // Game Loop Refs
    const requestRef = useRef<number>(0)
    const lastTimeRef = useRef<number>(0)
    const wallSpeedRef = useRef(WALL_SPEED_BASE)

    // Initialize MediaPipe (Copied from SignStreamGame)
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
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00f3ff", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#ff00ff", lineWidth: 1, radius: 3 });
                        setDetectedGesture(recognizeGesture(landmarks));
                    }
                }
                if (results.landmarks.length === 0) setDetectedGesture("NONE");
            }
        }
        requestAnimationFrame(predictWebcam);
    }, []);

    useEffect(() => {
        if (!isModelLoading) predictWebcam();
    }, [isModelLoading, predictWebcam]);

    // Game Logic
    const startGame = () => {
        setGameActive(true)
        setGameOver(false)
        setScore(0)
        setTimeLeft(GAME_DURATION)
        setWallScale(0)
        setTargetSign(getRandomSign())
        wallSpeedRef.current = WALL_SPEED_BASE
        lastTimeRef.current = performance.now()
        requestRef.current = requestAnimationFrame(gameLoop)
    }

    const getRandomSign = () => {
        const signs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
        return signs[Math.floor(Math.random() * signs.length)]
    }

    const gameLoop = (time: number) => {
        if (!lastTimeRef.current) lastTimeRef.current = time
        const deltaTime = time - lastTimeRef.current
        lastTimeRef.current = time

        if (gameOver) return

        setWallScale(prev => {
            // If bouncing, stay at 1 (or slightly less to simulate bounce)
            if (isBouncing) return 0.95 + Math.sin(time * 0.02) * 0.02

            const newScale = prev + (wallSpeedRef.current * deltaTime)

            // Collision Check
            if (newScale >= 1) {
                if (detectedGesture === targetSign) {
                    // Success!
                    setScore(s => s + 1)
                    setTargetSign(getRandomSign())
                    wallSpeedRef.current = Math.min(WALL_SPEED_MAX, wallSpeedRef.current + 0.0005) // Speed up
                    return 0 // Reset wall
                } else {
                    // Fail - Bounce
                    setIsBouncing(true)
                    return 1
                }
            }
            return newScale
        })

        requestRef.current = requestAnimationFrame(gameLoop)
    }

    // Check bounce resolution
    useEffect(() => {
        if (isBouncing && detectedGesture === targetSign) {
            setIsBouncing(false)
            setScore(s => s + 1)
            setTargetSign(getRandomSign())
            setWallScale(0) // Reset wall
        }
    }, [isBouncing, detectedGesture, targetSign])

    // Timer
    useEffect(() => {
        if (gameActive && !gameOver) {
            const timer = setInterval(() => {
                setTimeLeft(t => {
                    if (t <= 1) {
                        setGameOver(true)
                        setGameActive(false)
                        return 0
                    }
                    return t - 1
                })
            }, 1000)
            return () => clearInterval(timer)
        }
    }, [gameActive, gameOver])

    useEffect(() => {
        return () => cancelAnimationFrame(requestRef.current)
    }, [])

    return (
        <div className="relative w-full h-screen max-w-md mx-auto bg-black overflow-hidden flex flex-col font-sans select-none">
            {/* Webcam Background */}
            <div className="absolute inset-0 z-0">
                <Webcam ref={webcamRef} audio={false} className="w-full h-full object-cover" mirrored />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
                {/* Vignette */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.8)_100%)]" />
            </div>

            {/* HUD */}
            <div className="relative z-20 p-4 flex justify-between items-start">
                <Button variant="ghost" size="icon" onClick={onBack} className="text-white hover:text-neon-blue">
                    <ArrowLeft />
                </Button>
                <div className="flex flex-col items-center">
                    <div className="text-4xl font-black text-white drop-shadow-[0_0_10px_rgba(0,0,0,0.8)]">
                        {score}
                    </div>
                    <div className="text-xs text-neon-blue font-bold">WALLS PASSED</div>
                </div>
                <div className={cn("flex items-center gap-2 font-mono text-xl font-bold", timeLeft < 10 ? "text-red-500 animate-pulse" : "text-white")}>
                    <Timer className="w-5 h-5" />
                    {timeLeft}s
                </div>
            </div>

            {/* The Wall */}
            <div className="absolute inset-0 z-10 flex items-center justify-center perspective-[1000px]">
                {gameActive && (
                    <motion.div
                        className={cn(
                            "relative flex items-center justify-center border-[20px]",
                            isBouncing ? "border-red-600 bg-red-500/20" : "border-neon-blue bg-black/40"
                        )}
                        style={{
                            width: '100%',
                            height: '100%',
                            scale: wallScale, // Zoom effect
                            opacity: wallScale // Fade in as it gets closer
                        }}
                    >
                        {/* The Hole (Target Sign) */}
                        <div className={cn(
                            "w-64 h-64 bg-black/80 rounded-3xl flex items-center justify-center border-4 shadow-[0_0_50px_rgba(0,0,0,0.5)]",
                            isBouncing ? "border-red-500 animate-shake" : "border-white"
                        )}>
                            <img
                                src={`/signs/${targetSign}.png`}
                                alt={targetSign}
                                className="w-48 h-48 object-contain invert"
                            />
                        </div>

                        {/* Bouncing Text */}
                        {isBouncing && (
                            <div className="absolute top-1/4 text-6xl font-black text-red-500 animate-bounce drop-shadow-lg">
                                MATCH IT!
                            </div>
                        )}
                    </motion.div>
                )}
            </div>

            {/* Start / Game Over Overlay */}
            {(!gameActive || gameOver) && (
                <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                    <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-neon-pink mb-4 italic tracking-tighter">
                        HOLE IN THE WALL
                    </h1>

                    {gameOver ? (
                        <div className="mb-8">
                            <div className="text-2xl text-white mb-2">TIME'S UP!</div>
                            <div className="text-6xl font-bold text-neon-blue mb-4">{score}</div>
                            <div className="text-gray-400">Walls Passed</div>
                        </div>
                    ) : (
                        <p className="text-gray-300 mb-8 text-lg max-w-xs">
                            Match the sign on the wall before it hits you!
                            <br /><br />
                            <span className="text-neon-pink font-bold">Don't let it bounce!</span>
                        </p>
                    )}

                    {isModelLoading ? (
                        <div className="flex flex-col items-center gap-4">
                            <Loader2 className="w-8 h-8 text-neon-blue animate-spin" />
                            <p className="text-white">Loading AI...</p>
                        </div>
                    ) : (
                        <Button
                            onClick={startGame}
                            className="bg-neon-blue hover:bg-cyan-400 text-black font-bold text-xl px-12 py-8 rounded-full shadow-[0_0_30px_rgba(0,243,255,0.4)] transition-transform hover:scale-110"
                        >
                            {gameOver ? "PLAY AGAIN" : "START CHALLENGE"}
                        </Button>
                    )}

                    {gameOver && (
                        <Button variant="ghost" onClick={onBack} className="mt-4 text-white hover:text-red-400">
                            EXIT
                        </Button>
                    )}
                </div>
            )}

            {/* Player's Detected Sign (Bottom Center) */}
            {gameActive && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center">
                    <div className="text-xs text-white/50 mb-1">YOU ARE SIGNING</div>
                    <div className={cn(
                        "w-20 h-20 rounded-2xl flex items-center justify-center border-2 bg-black/50 backdrop-blur-md transition-colors",
                        detectedGesture === targetSign ? "border-green-500 text-green-500" : "border-white/20 text-white"
                    )}>
                        <span className="text-4xl font-bold">{detectedGesture}</span>
                    </div>
                </div>
            )}
        </div>
    )
}
