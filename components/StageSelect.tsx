import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Lock, Star, Trophy, User, Play } from 'lucide-react'
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
                    <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-neon-pink mb-2 tracking-tighter italic">
                        SignStream
                    </h1>
                    <p className="text-gray-400">Select a Stage</p>
                </div>

                {userEmail ? (
                    <div className="flex items-center gap-2">
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
                    <Button
                        onClick={() => setIsAuthOpen(true)}
                        className="bg-white/10 hover:bg-white/20 text-white rounded-full px-4"
                    >
                        Login
                    </Button>
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
        </div>
    )
}
