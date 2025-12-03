export type Stage = {
    id: number;
    name: string;
    description: string;
    phrases: string[];
    speedMultiplier: number;
    requiredScore: number;
    color: string;
};

export const STAGES: Stage[] = [
    {
        id: 1,
        name: "The Basics",
        description: "Start with simple letters.",
        phrases: ["HI", "YO", "ABC"],
        speedMultiplier: 1.0,
        requiredScore: 500,
        color: "from-green-400 to-emerald-600"
    },
    {
        id: 2,
        name: "Action Words",
        description: "Move your hands!",
        phrases: ["NO", "TIME"],
        speedMultiplier: 1.0, // Slower for actions
        requiredScore: 2000,
        color: "from-blue-400 to-cyan-600"
    },
    {
        id: 3,
        name: "Speed Demon",
        description: "Fast tiles, no mercy.",
        phrases: ["QUICK", "JUMP", "ZEBRA", "VORTEX", "MATRIX", "FLIGHT", "POWER"],
        speedMultiplier: 1.5,
        requiredScore: 3000,
        color: "from-purple-400 to-pink-600"
    },
    {
        id: 4,
        name: "Master Class",
        description: "Complex patterns, maximum speed.",
        phrases: ["SYMPHONY", "RHYTHM", "JAZZ", "PUZZLE", "OXYGEN", "CRYPTO"],
        speedMultiplier: 1.8,
        requiredScore: 5000,
        color: "from-orange-400 to-red-600"
    },
    {
        id: 5,
        name: "SignStream God",
        description: "The ultimate challenge.",
        phrases: ["VOCABULARY", "COLLABORATE", "AVAILABILITY", "EXTRAORDINARY", "KNOWLEDGE", "UNDERSTAND"],
        speedMultiplier: 2.0,
        requiredScore: 10000,
        color: "from-red-500 to-rose-900"
    }
];
