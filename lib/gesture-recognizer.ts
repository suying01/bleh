import { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type Gesture = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z" | "NONE";
export type Orientation = "UP" | "DOWN" | "SIDE" | "NONE";

export function checkOrientation(landmarks: NormalizedLandmark[]): Orientation {
    if (!landmarks || landmarks.length === 0) return "NONE";
    const wrist = landmarks[0];
    const indexTip = landmarks[8];

    const dx = Math.abs(indexTip.x - wrist.x);
    const dy = Math.abs(indexTip.y - wrist.y);

    if (dx > dy) {
        return "SIDE";
    }
    // In MediaPipe, Y increases downwards. 0 is top, 1 is bottom.
    // If Tip Y < Wrist Y, tip is above wrist -> UP.
    if (indexTip.y < wrist.y) {
        return "UP";
    }
    return "DOWN";
}

export function recognizeGesture(landmarks: NormalizedLandmark[]): Gesture {
    if (!landmarks || landmarks.length === 0) return "NONE";

    const orientation = checkOrientation(landmarks);

    // Landmarks
    const wrist = landmarks[0];
    const thumbCmc = landmarks[1];
    const thumbMcp = landmarks[2];
    const thumbIp = landmarks[3];
    const thumbTip = landmarks[4];

    const indexMcp = landmarks[5];
    const indexPip = landmarks[6];
    const indexDip = landmarks[7];
    const indexTip = landmarks[8];

    const middleMcp = landmarks[9];
    const middlePip = landmarks[10];
    const middleDip = landmarks[11];
    const middleTip = landmarks[12];

    const ringMcp = landmarks[13];
    const ringPip = landmarks[14];
    const ringDip = landmarks[15];
    const ringTip = landmarks[16];

    const pinkyMcp = landmarks[17];
    const pinkyPip = landmarks[18];
    const pinkyDip = landmarks[19];
    const pinkyTip = landmarks[20];

    // Helpers
    const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);

    // Is finger extended? (Tip further from wrist than PIP)
    const isExtended = (tip: NormalizedLandmark, pip: NormalizedLandmark) => dist(tip, wrist) > dist(pip, wrist);

    // Is thumb extended? (Tip further from Index MCP than IP)
    const isThumbExtended = () => dist(thumbTip, indexMcp) > dist(thumbIp, indexMcp);

    // Finger States
    const thumbOpen = isThumbExtended();
    const indexOpen = isExtended(indexTip, indexPip);
    const middleOpen = isExtended(middleTip, middlePip);
    const ringOpen = isExtended(ringTip, ringPip);
    const pinkyOpen = isExtended(pinkyTip, pinkyPip);

    // Distances
    const dThumbIndex = dist(thumbTip, indexTip);
    const dThumbMiddle = dist(thumbTip, middleTip);
    const dIndexMiddle = dist(indexTip, middleTip);

    // --- LOGIC ---

    // 1. Fist / Curled Fingers Group (A, E, S, T, M, N)
    if (!indexOpen && !middleOpen && !ringOpen && !pinkyOpen) {
        // A: Thumb UP (alongside index).
        if (thumbOpen) return "A";

        // S: Thumb ACROSS fingers (Fist).
        // Thumb tip should be crossing the fingers.
        // E: Thumb curled UNDER fingers (tips touch thumb).
        // T: Thumb between Index and Middle.
        // M: Thumb under 3 fingers.
        // N: Thumb under 2 fingers.

        // Check Thumb Tip X position relative to finger PIPs (assuming right hand or relative order).
        // Let's use distance to specific joints.

        // T: Thumb tip close to Index PIP/MCP
        if (dist(thumbTip, indexPip) < 0.05 || dist(thumbTip, indexMcp) < 0.05) return "T";

        // N: Thumb tip close to Middle PIP/MCP
        if (dist(thumbTip, middlePip) < 0.05 || dist(thumbTip, middleMcp) < 0.05) return "N";

        // M: Thumb tip close to Ring/Pinky PIP/MCP
        if (dist(thumbTip, ringPip) < 0.05 || dist(thumbTip, pinkyPip) < 0.05) return "M";

        // E: Thumb curled. Tip is close to Index MCP or Palm.
        // S: Thumb crosses over. Tip is usually near Index DIP or Middle DIP.

        // Distinction E vs S:
        // E: Thumb tip is lower (closer to wrist/palm).
        // S: Thumb tip is higher (closer to finger tips).
        // Let's check distance of Thumb Tip to Index DIP.
        if (dist(thumbTip, indexDip) < 0.05) return "S";

        return "E"; // Default to E if curled and not others
    }

    // 2. Index Only Group (D, Z, X, L, G, P, Q)
    if (indexOpen && !middleOpen && !ringOpen && !pinkyOpen) {
        // L: Thumb UP.
        if (thumbOpen) {
            // G: Index side, Thumb parallel side.
            if (orientation === "SIDE") return "G";
            return "L";
        }

        // D: Thumb touching Middle/Ring. Index UP.
        if (orientation === "DOWN") {
            // Q: G shape pointing down. Thumb usually out.
            if (thumbOpen) return "Q"; // Or just Q if index down?
            // P is K shape down (Index + Middle).
            // If only Index is down... maybe Z?
            return "Z"; // Z is index drawing, often points forward/down.
        }

        // G: Index side.
        if (orientation === "SIDE") {
            // G usually has thumb out.
            // If thumb not out... maybe pointing?
            return "G";
        }

        // X: Index Hooked.
        // Check if Index Tip is close to Index PIP?
        if (dist(indexTip, indexPip) < 0.08) return "X";

        return "D"; // Default to D (Index Up)
    }

    // 3. Index + Middle Group (U, V, H, K, P, R)
    if (indexOpen && middleOpen && !ringOpen && !pinkyOpen) {
        // P: Pointing DOWN. Thumb between index/middle.
        if (orientation === "DOWN") return "P";

        // H: Pointing SIDE.
        if (orientation === "SIDE") return "H";

        // R: Crossed.
        // Check distance between tips vs MCPs?
        // If tips are closer than MCPs?
        // Or just check if they overlap.
        if (dist(indexTip, middleTip) < 0.03) return "U"; // Together

        // K: Thumb on Middle knuckle.
        // Thumb tip close to Middle PIP/MCP.
        if (dist(thumbTip, middlePip) < 0.06) return "K";

        // V: Separated.
        return "V";
    }

    // 4. Three Fingers (W)
    if (indexOpen && middleOpen && ringOpen && !pinkyOpen) {
        return "W";
    }

    // 5. Pinky / Horns (I, J, Y)
    if (!indexOpen && !middleOpen && !ringOpen && pinkyOpen) {
        // Y: Thumb UP.
        if (thumbOpen) return "Y";
        // I: Thumb curled.
        return "I"; // J is motion I
    }

    // 6. Open Hand / C / O / F
    // F: Index/Thumb touching, others OPEN.
    if (!indexOpen && middleOpen && ringOpen && pinkyOpen) {
        // Index is closed (touching thumb).
        return "F";
    }
    // Wait, F description: "Touch tip of index to thumb... keep others separated and pointing up".
    // So Index is technically "curled" to touch thumb, but Middle/Ring/Pinky are OPEN.
    // Our isExtended(index) might be false.

    if (middleOpen && ringOpen && pinkyOpen) {
        if (dist(thumbTip, indexTip) < 0.06) return "F";
    }

    // B: All open, Thumb tucked.
    if (indexOpen && middleOpen && ringOpen && pinkyOpen) {
        // C: Curved.
        // O: Tips touching thumb.

        // O check: All tips close to thumb?
        // Description: "Touch all fingertips to thumb".
        // So fingers are curled to meet thumb. They wouldn't register as "Open" by our definition?
        // If O, fingers are curled.
    }

    // Re-evaluating O and C based on "Curled" state.
    // If fingers are NOT fully open (maybe half curled?), they might fail isExtended.

    // O: All touching thumb.
    if (dist(thumbTip, indexTip) < 0.06 && dist(thumbTip, middleTip) < 0.06) {
        return "O";
    }

    // C: Curved. Gap.
    if (indexOpen && middleOpen && ringOpen && pinkyOpen) {
        if (dThumbIndex > 0.05 && dThumbIndex < 0.25) return "C";
        return "B"; // Flat hand
    }

    return "NONE";
}

// --- Dynamic Gesture Support ---

export class GestureBuffer {
    buffer: NormalizedLandmark[][][] = []; // Array of Frames. Each Frame is Array of Hands.
    maxSize: number;

    constructor(maxSize: number = 30) {
        this.maxSize = maxSize;
    }

    add(landmarks: NormalizedLandmark[][]) {
        this.buffer.push(landmarks);
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
    }

    getBuffer() {
        return this.buffer;
    }

    clear() {
        this.buffer = [];
    }
}

export function recognizeDynamicGesture(buffer: GestureBuffer): string | null {
    const frames = buffer.getBuffer();
    if (frames.length < 5) return null;

    const currentFrame = frames[frames.length - 1];
    if (currentFrame.length === 0) return null;

    // Helpers
    const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);
    const isExtended = (tip: NormalizedLandmark, pip: NormalizedLandmark, wrist: NormalizedLandmark) => dist(tip, wrist) > dist(pip, wrist);

    // Helper to check if a hand matches "Y" shape
    const checkYShape = (landmarks: NormalizedLandmark[]) => {
        const thumbOpen = isExtended(landmarks[4], landmarks[2], landmarks[0]);
        const pinkyOpen = isExtended(landmarks[20], landmarks[18], landmarks[0]);
        const indexClosed = !isExtended(landmarks[8], landmarks[6], landmarks[0]);
        const middleClosed = !isExtended(landmarks[12], landmarks[10], landmarks[0]);
        const ringClosed = !isExtended(landmarks[16], landmarks[14], landmarks[0]);
        return thumbOpen && pinkyOpen && indexClosed && middleClosed && ringClosed;
    };

    // Helper to check if a hand matches "Open Hand"
    const checkOpenHand = (landmarks: NormalizedLandmark[]) => {
        return landmarks[8].y < landmarks[5].y && landmarks[12].y < landmarks[9].y && landmarks[16].y < landmarks[13].y && landmarks[20].y < landmarks[17].y;
    };

    // Helper to check if a hand is a fist
    const isFist = (l: NormalizedLandmark[]) => !isExtended(l[8], l[6], l[0]) && !isExtended(l[12], l[10], l[0]) && !isExtended(l[16], l[14], l[0]) && !isExtended(l[20], l[18], l[0]);
    // Helper to check if a hand is flat (all fingers extended)
    const isFlat = (l: NormalizedLandmark[]) => isExtended(l[8], l[6], l[0]) && isExtended(l[12], l[10], l[0]) && isExtended(l[16], l[14], l[0]) && isExtended(l[20], l[18], l[0]);
    // Helper to check if a hand is pointing (index extended, others not)
    const isPointing = (l: NormalizedLandmark[]) => isExtended(l[8], l[6], l[0]) && !isExtended(l[12], l[10], l[0]) && !isExtended(l[16], l[14], l[0]) && !isExtended(l[20], l[18], l[0]);


    // 1. HELLO (Wave) - 1 Hand
    // Logic: Hand mostly Open + Wrist Moving Left <-> Right (Oscillation)
    // Check if hand was open in at least 70% of last 20 frames
    const recentFramesForHello = frames.slice(-20);
    const openHandCount = recentFramesForHello.filter(f => f.some(h => checkOpenHand(h))).length;

    if (openHandCount > 14) { // > 70%
        // Try to find a consistent "waving" hand.
        // This is tricky without hand IDs. Let's assume the most prominent hand.
        // Or, if ANY hand is waving.

        // Collect wrist X positions for all hands that were open
        const wristXs: number[] = [];
        for (const frame of recentFramesForHello) {
            const openHandsInFrame = frame.filter(h => checkOpenHand(h));
            if (openHandsInFrame.length > 0) {
                // Take the wrist X of the first open hand found in this frame
                wristXs.push(openHandsInFrame[0][0].x);
            }
        }

        if (wristXs.length > 10) { // Need enough data points
            // Count direction changes in X
            let directionChanges = 0;
            let lastDir = 0;

            for (let i = 1; i < wristXs.length; i++) {
                const dx = wristXs[i] - wristXs[i - 1];
                if (Math.abs(dx) > 0.005) {
                    const dir = dx > 0 ? 1 : -1;
                    if (lastDir !== 0 && dir !== lastDir) {
                        directionChanges++;
                    }
                    lastDir = dir;
                }
            }

            const minX = Math.min(...wristXs);
            const maxX = Math.max(...wristXs);

            // Require oscillation (wave) AND significant range
            if (directionChanges >= 2 && (maxX - minX) > 0.1) {
                return "HELLO";
            }
        }
    }

    // 2. YES (Y-Hand + Nod) - 1 Hand
    // Check if ANY hand in recent frames matches Y + Nod
    const yHand = currentFrame.find(h => checkYShape(h));
    if (yHand) {
        const yHandHistory: NormalizedLandmark[][] = [];
        for (const frame of frames.slice(-15)) {
            const foundYHand = frame.find(h => checkYShape(h));
            if (foundYHand) {
                yHandHistory.push(foundYHand);
            }
        }

        if (yHandHistory.length > 8) { // Need enough Y-shaped frames
            const wristYs = yHandHistory.map(h => h[0].y);
            const wristXs = yHandHistory.map(h => h[0].x);

            let directionChanges = 0;
            let lastDir = 0;
            for (let i = 1; i < wristYs.length; i++) {
                const dy = wristYs[i] - wristYs[i - 1];
                if (Math.abs(dy) > 0.005) {
                    const dir = dy > 0 ? 1 : -1;
                    if (lastDir !== 0 && dir !== lastDir) directionChanges++;
                    lastDir = dir;
                }
            }

            const rangeY = Math.max(...wristYs) - Math.min(...wristYs);
            const rangeX = Math.max(...wristXs) - Math.min(...wristXs);

            if (directionChanges >= 2 && rangeY > 0.1 && rangeY > rangeX * 1.5) {
                return "YES";
            }
        }
    }

    // 3. NO (Tap) - 1 Hand
    // Logic: Transition from Open to Closed (Thumb+Index+Middle touching).
    const isTapPose = (landmarks: NormalizedLandmark[]) => {
        const dThumbIndex = dist(landmarks[4], landmarks[8]);
        const dThumbMiddle = dist(landmarks[4], landmarks[12]);
        return dThumbIndex < 0.05 && dThumbMiddle < 0.05;
    };

    const tapHand = currentFrame.find(h => isTapPose(h));
    if (tapHand) {
        // Check history: Was it OPEN recently?
        // Look back 15 frames.
        const wasOpen = frames.slice(-15, -5).some(f => f.some(h => {
            const dTI = dist(h[4], h[8]);
            const dTM = dist(h[4], h[12]);
            return dTI > 0.1 && dTM > 0.1; // Fingers were apart
        }));

        if (wasOpen) {
            return "NO";
        }
    }

    // 4. HELP (Fist on Palm + Lift) - 2 Hands
    if (currentFrame.length >= 2) {
        const hand1 = currentFrame[0];
        const hand2 = currentFrame[1];

        let fistHand, flatHand;
        if (isFist(hand1) && isFlat(hand2)) { fistHand = hand1; flatHand = hand2; }
        else if (isFist(hand2) && isFlat(hand1)) { fistHand = hand2; flatHand = hand1; }

        if (fistHand && flatHand) {
            // Check Proximity: Fist Wrist close to Flat Palm (Index MCP/Pinky MCP center?)
            // Let's use Fist Wrist (0) to Flat Hand Middle MCP (9) as a proxy for palm center.
            const dProximity = dist(fistHand[0], flatHand[9]);

            if (dProximity < 0.15) { // Adjust threshold as needed
                // Check Upward Motion
                // We need history of 2 hands.
                const recentFramesForHelp = frames.slice(-10);
                // Calculate avg Y of all hands in frame
                const avgYs: number[] = [];
                for (const frame of recentFramesForHelp) {
                    if (frame.length >= 2) {
                        // Try to match the fist and flat hand from the current frame
                        let currentFist = frame.find(h => isFist(h));
                        let currentFlat = frame.find(h => isFlat(h));
                        if (currentFist && currentFlat) {
                            avgYs.push((currentFist[0].y + currentFlat[0].y) / 2);
                        } else {
                            // If we can't find both, use average of all hands or skip
                            avgYs.push(frame.reduce((sum, h) => sum + h[0].y, 0) / frame.length);
                        }
                    } else if (frame.length === 1) {
                        avgYs.push(frame[0][0].y);
                    } else {
                        avgYs.push(1); // Placeholder for no hands, will be filtered out by range check
                    }
                }

                if (avgYs.length > 5) { // Need enough frames with hands
                    const startY = avgYs[0];
                    const endY = avgYs[avgYs.length - 1];

                    if (startY - endY > 0.1) { // Significant upward move (Y decreases upwards)
                        return "HELP";
                    }
                }
            }
        }
    }

    // 5. TIME (Tap Wrist) - 2 Hands
    if (currentFrame.length >= 2) {
        const hand1 = currentFrame[0];
        const hand2 = currentFrame[1];

        let pointerHand, targetHand;
        if (isPointing(hand1)) { pointerHand = hand1; targetHand = hand2; }
        else if (isPointing(hand2)) { pointerHand = hand2; targetHand = hand1; }

        if (pointerHand && targetHand) {
            // Check Index Tip (8) of pointerHand to Wrist (0) of targetHand
            const dTouch = dist(pointerHand[8], targetHand[0]);

            if (dTouch < 0.1) { // Adjust threshold as needed
                // Maybe check for tapping motion? 
                // Or just contact is enough for now.
                return "TIME";
            }
        }
    }

    return null;
}
