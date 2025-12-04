import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Lock, Star, Trophy, User, Play, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { STAGES, Stage } from '@/lib/stages'
import AuthModal from './AuthModal'
import { supabase } from '@/lib/supabase/client'

type StageSelectProps = {
    onSelectStage: (stage: Stage) => void
    onSelectChallenge: () => void
}

export default function StageSelect({ onSelectStage, onSelectChallenge }: StageSelectProps) {
    const [isAuthOpen, setIsAuthOpen] = useState(false)
    const [userEmail, setUserEmail] = useState<string | null>(null)
    const [completedStages, setCompletedStages] = useState<number[]>([])
    const homepageAudioRef = React.useRef<HTMLAudioElement | null>(null)
    const [isHomepageMuted, setIsHomepageMuted] = useState<boolean>(() => {
        try {
            const v = localStorage.getItem('signum-homepage-muted')
            return v === 'true'
        } catch (e) {
            return false
        }
    })
    const [isMusicPlaying, setIsMusicPlaying] = useState(true)

    useEffect(() => {
        // Check active session and load progress
        const loadProgress = async () => {
            const { data: { session } } = await supabase.auth.getSession()
            setUserEmail(session?.user?.email ?? null)

            if (session?.user) {
                // Load from Supabase
                const { data } = await supabase
                    .from('scores')
                    .select('stage_id')
                    .eq('user_id', session.user.id)

                if (data) {
                    const stages = data.map((s: any) => parseInt(s.stage_id))
                    setCompletedStages(stages)
                }
            } else {
                // Load from LocalStorage
                try {
                    const local = JSON.parse(localStorage.getItem('unlockedStages') || '[]')
                    setCompletedStages(local)
                } catch (e) {
                    console.error("Failed to load local progress", e)
                }
            }
        }

        loadProgress()
    }, [])

    // Sync homepage mute state and start music on mount
    useEffect(() => {
        try {
            localStorage.setItem('signum-homepage-muted', String(isHomepageMuted))
        } catch (e) {}
        if (homepageAudioRef.current) {
            homepageAudioRef.current.muted = isHomepageMuted
            // If unmuting, try to play immediately
            if (!isHomepageMuted) {
                const playPromise = homepageAudioRef.current.play()
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            setIsMusicPlaying(true)
                        })
                        .catch((e) => {
                            console.warn('Play failed (autoplay policy):', e.message)
                            setIsMusicPlaying(false)
                        })
                } else {
                    setIsMusicPlaying(true)
                }
            } else {
                // If muting, pause
                homepageAudioRef.current.pause()
                setIsMusicPlaying(false)
            }
        }
    }, [isHomepageMuted])

    // Auto-play homepage music on mount (user gesture or browser policy might allow it)
    useEffect(() => {
        const playHomepageMusic = () => {
            if (homepageAudioRef.current && !isHomepageMuted) {
                homepageAudioRef.current.volume = 0.5
                const playPromise = homepageAudioRef.current.play()
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            setIsMusicPlaying(true)
                        })
                        .catch((e) => {
                            console.warn('Homepage music autoplay blocked:', e.message)
                            setIsMusicPlaying(false)
                        })
                } else {
                    setIsMusicPlaying(true)
                }
            }
        }
        playHomepageMusic()

        // Also attempt to play when the page regains focus (e.g., returning from game)
        const handleFocus = () => {
            playHomepageMusic()
        }
        window.addEventListener('focus', handleFocus)
        return () => {
            window.removeEventListener('focus', handleFocus)
        }
    }, [isHomepageMuted])

    const handleLogout = async () => {
        await supabase.auth.signOut()
        setUserEmail(null)
        setCompletedStages([]) // Reset or fallback to local? Let's reset for clarity
        // Optionally fallback to local:
        // const local = JSON.parse(localStorage.getItem('unlockedStages') || '[]')
        // setCompletedStages(local)
    }

    return (
        <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center font-sans">
            <header className="w-full max-w-md mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-neon-pink mb-2 tracking-tighter italic pb-1 pr-2">
                        Signum
                    </h1>
                    <p className="text-gray-400">Select a Stage</p>
                </div>

                {userEmail ? (
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setIsHomepageMuted(m => { const next = !m; try { localStorage.setItem('signum-homepage-muted', String(next)) } catch(e){}; return next })}
                            aria-label={isHomepageMuted ? 'Unmute music' : 'Mute music'}
                            className="rounded-full border-white/20 hover:bg-white/10 text-white"
                        >
                            {isHomepageMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={handleLogout}
                            className="rounded-full border-white/20 hover:bg-white/10 text-white"
                            title="Logout"
                        >
                            <User className="w-4 h-4" />
                        </Button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setIsHomepageMuted(m => { const next = !m; try { localStorage.setItem('signum-homepage-muted', String(next)) } catch(e){}; return next })}
                            aria-label={isHomepageMuted ? 'Unmute music' : 'Mute music'}
                            className="rounded-full border-white/20 hover:bg-white/10 text-white"
                        >
                            {isHomepageMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </Button>
                        <Button
                            onClick={() => setIsAuthOpen(true)}
                            className="bg-white/10 hover:bg-white/20 text-white rounded-full px-4"
                        >
                            Login
                        </Button>
                    </div>
                )}
            </header>

            <div className="w-full max-w-md flex flex-col gap-4 mb-8">
                {STAGES.map((stage, index) => {
                    // Stage is locked if it's NOT the first one AND the previous stage hasn't been completed
                    const isLocked = index > 0 && !completedStages.includes(STAGES[index - 1].id)

                    return (
                        <motion.div
                            key={stage.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                        >
                            <Card
                                className={cn(
                                    "bg-gray-900/50 border-2 transition-all duration-300 overflow-hidden relative",
                                    isLocked
                                        ? "border-gray-800 opacity-50 cursor-not-allowed grayscale"
                                        : "border-gray-800 hover:border-neon-blue cursor-pointer group"
                                )}
                                onClick={() => !isLocked && onSelectStage(stage)}
                            >
                                <div className={cn("absolute inset-0 opacity-0 group-hover:opacity-10 bg-gradient-to-r transition-opacity", stage.color)} />

                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <div className="flex flex-col">
                                        <CardTitle className={cn("text-xl font-bold transition-colors", isLocked ? "text-gray-500" : "text-white group-hover:text-neon-blue")}>
                                            {stage.id}. {stage.name}
                                        </CardTitle>
                                        <CardDescription className="text-gray-400">
                                            {stage.description}
                                        </CardDescription>
                                    </div>
                                    {isLocked ? (
                                        <Lock className="text-gray-600 w-6 h-6" />
                                    ) : (
                                        <Play className="text-neon-blue w-8 h-8 fill-current opacity-0 group-hover:opacity-100 transition-opacity" />
                                    )}
                                </CardHeader>

                                <CardContent>
                                    <div className="flex justify-between items-center text-sm">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="secondary" className="bg-gray-800 text-gray-300">
                                                {stage.phrases.length} Phrases
                                            </Badge>
                                            <Badge variant="secondary" className="bg-gray-800 text-gray-300">
                                                {stage.speedMultiplier}x Speed
                                            </Badge>
                                            {stage.id === 2 && (
                                                <Badge variant="secondary" className="bg-neon-blue text-black font-bold">
                                                    ACTION MODE
                                                </Badge>
                                            )}
                                            {stage.id === 3 && (
                                                <Badge variant="secondary" className="bg-neon-pink text-black font-bold">
                                                    POSE MODE
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 text-yellow-500">
                                            <Trophy className="w-4 h-4" />
                                            <span className="font-bold">{stage.requiredScore}</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    )
                })}
            </div>

            {/* Special Challenge Button */}
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 }}
                className="w-full max-w-md"
            >
                {/*}
                <Button
                    onClick={onSelectChallenge}
                    className="w-full h-24 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 border-2 border-white/20 rounded-2xl relative overflow-hidden group"
                >
                    <div className="absolute inset-0 bg-[url('/noise.png')] opacity-10" />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />

                    <div className="relative z-10 flex flex-col items-center">
                        <div className="text-2xl font-black italic tracking-tighter text-white drop-shadow-lg mb-1">
                            HOLE IN THE WALL
                        </div>
                        <div className="text-xs font-bold text-white/80 bg-black/30 px-3 py-1 rounded-full border border-white/10">
                            SPECIAL CHALLENGE
                        </div>
                    </div>

                    <Play className="absolute right-6 w-8 h-8 text-white opacity-50 group-hover:opacity-100 group-hover:scale-110 transition-all" />
                </Button>
                */}
            </motion.div>

            <AuthModal
                isOpen={isAuthOpen}
                onClose={() => setIsAuthOpen(false)}
                onLoginSuccess={(email) => setUserEmail(email)}
            />

            {/* Play Music Prompt (if autoplay failed) */}
            {!isMusicPlaying && !isHomepageMuted && (
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-neon-blue/20 border border-neon-blue rounded-full px-6 py-3 flex items-center gap-3 backdrop-blur-sm"
                >
                    <span className="text-white text-sm font-semibold">Enable sound?</span>
                    <Button
                        onClick={() => {
                            if (homepageAudioRef.current) {
                                homepageAudioRef.current.volume = 0.5
                                void homepageAudioRef.current.play()
                                setIsMusicPlaying(true)
                            }
                        }}
                        className="bg-neon-blue hover:bg-cyan-400 text-black font-bold px-4 py-1 rounded-full text-sm"
                    >
                        <Play className="w-3 h-3 mr-1 fill-current" /> Play
                    </Button>
                </motion.div>
            )}

            {/* Homepage music (place at public/music/homepage.mp3) */}
            <audio
                ref={homepageAudioRef}
                src="/music/homepage.mp3"
                loop
                preload="auto"
                style={{ display: 'none' }}
            />
        </div>
    )
}
