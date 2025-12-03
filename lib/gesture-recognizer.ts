import { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type Gesture = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z" | "6-7" | "NONE";
export type Orientation = "UP" | "DOWN" | "SIDE" | "NONE";

let prevLandmarks: NormalizedLandmark[] | null = null;
let verticalHistory: number[] = [];   // stores dy signs (-1 = up, +1 = down)

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

    let motion = null;

    if (prevLandmarks) {
        const prevWrist = prevLandmarks[0];

        const dx = wrist.x - prevWrist.x;
        const dy = wrist.y - prevWrist.y;
        const dz = wrist.z - prevWrist.z;

        motion = { dx, dy, dz, speed: Math.hypot(dx, dy) };

        let verticalDir = 0;

        if (dy < -0.02) verticalDir = -1;  // Moving UP
        if (dy >  0.02) verticalDir = +1;  // Moving DOWN

        if (verticalDir !== 0) {
            verticalHistory.push(verticalDir);
            
            // Keep last 20 frames
            if (verticalHistory.length > 20) {
                verticalHistory.shift();
            }
        }
    }

    // --- MOTION GESTURES ---
    if (verticalHistory.length > 6) {
        let directionChanges = 0;

        for (let i = 1; i < verticalHistory.length; i++) {
            if (verticalHistory[i] !== verticalHistory[i - 1]) {
                directionChanges++;
            }
        }

        // If there are 4+ alternations, that's a shake (UP-DOWN-UP-DOWN)
        if (directionChanges >= 4) {
            verticalHistory = []; // reset so it doesn't trigger nonstop
            prevLandmarks = landmarks;
            return "6-7";
        }
    }

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

    prevLandmarks = landmarks;
    return "NONE";
}
