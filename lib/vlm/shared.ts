export interface FrameEvent {
  timestamp: string;
  description: string;
  isDangerous: boolean;
}

export interface RiskContext {
  cameraId: string;
  score: number;
  tier: "low" | "med" | "high" | "critical";
  reasons: string[];
  windowStart?: string;
  windowEnd?: string;
}

export interface AnalyzeFrameOptions {
  base64Image: string;
  transcript?: string;
  riskContext?: RiskContext;
  cameraId?: string;
}

export interface AnalyzeFrameResult {
  events: FrameEvent[];
  rawResponse: string;
  riskScoreAtTime?: number;
}

export const DETECTION_PROMPT = `Analyze this frame and determine if any of these specific dangerous situations are occurring:

1. Medical Emergencies:
- Person unconscious or lying motionless
- Person clutching chest/showing signs of heart problems
- Seizures or convulsions
- Difficulty breathing or choking

2. Falls and Injuries:
- Person falling or about to fall
- Person on the ground after a fall
- Signs of injury or bleeding
- Limping or showing signs of physical trauma

3. Distress Signals:
- Person calling for help or showing distress
- Panic attacks or severe anxiety symptoms
- Signs of fainting or dizziness
- Headache or unease
- Signs of unconsciousness

4. Violence or Threats:
- Physical altercations
- Threatening behavior
- Weapons visible

5. Suspicious Activities:
- Shoplifting
- Vandalism
- Trespassing

6. Traffic and Pedestrian Hazards:
- Near-miss between vehicles and pedestrians
- Jaywalking clusters in heavy traffic
- Vehicles running red lights or stop signs
- Blocked crosswalks or emergency lanes`;

export const OUTPUT_INSTRUCTIONS = `For each observation in this frame, emit one event with a "mm:ss" timestamp, a brief description, and an isDangerous flag. Return at most three events. Each description must be one or two concise sentences, no more than 400 characters. Do not repeat phrases or invent details that are not visible. Set isDangerous=true if the event involves a fall, injury, unease, pain, accident, traffic hazard, or concerning behavior; otherwise false. If nothing concerning is visible, still emit at least one event describing the normal scene with isDangerous=false.`;

export const FRAME_EVENTS_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp: { type: "string" },
          description: { type: "string" },
          isDangerous: { type: "boolean" },
        },
        required: ["timestamp", "description", "isDangerous"],
      },
    },
  },
  required: ["events"],
} as const;

export function buildPrompt(opts: AnalyzeFrameOptions): string {
  const transcriptLine = opts.transcript
    ? `\nConsider this audio transcript from the scene: "${opts.transcript}"\n`
    : "";

  const riskLine = opts.riskContext
    ? `\nContextual risk signal for this camera's location (from NYC Open Data):
- Predicted risk tier: ${opts.riskContext.tier.toUpperCase()} (score ${opts.riskContext.score.toFixed(
        2
      )})
- Reasons: ${opts.riskContext.reasons.join("; ") || "n/a"}
When risk tier is HIGH or CRITICAL, be more sensitive to subtle precursor behavior (loitering, erratic movement, sudden dispersal, near-miss pedestrian/vehicle interactions).\n`
    : "";

  return `${DETECTION_PROMPT}${transcriptLine}${riskLine}\n${OUTPUT_INSTRUCTIONS}`;
}

export function toDataUrl(input: string): string {
  if (input.startsWith("data:")) return input;
  return `data:image/jpeg;base64,${input}`;
}

export function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1];
  const rawMatch = text.match(/\{[\s\S]*\}/);
  if (rawMatch) return rawMatch[0];
  return text;
}

// Structured JSON can still contain runaway generation or incorrect field types.
// Reject the whole result instead of labeling an unreliable observation safe.
export function validateFrameEvents(value: unknown): FrameEvent[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    throw new Error("Frame analysis returned an invalid number of observations.");
  }
  return value.map((event) => {
    if (
      !event || typeof event.timestamp !== "string" ||
      typeof event.description !== "string" ||
      typeof event.isDangerous !== "boolean"
    ) {
      throw new Error("Frame analysis returned an invalid observation.");
    }
    const description = event.description.trim();
    const words = description.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/);
    const phraseCounts = new Map<string, number>();
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i + 1]}`;
      const count = (phraseCounts.get(phrase) ?? 0) + 1;
      if (count >= 4) {
        throw new Error("Frame analysis returned repetitive text. This frame was skipped.");
      }
      phraseCounts.set(phrase, count);
    }
    if (!description || description.length > 400) {
      throw new Error("Frame analysis returned an empty or overly long description. This frame was skipped.");
    }
    return { timestamp: event.timestamp, description, isDangerous: event.isDangerous };
  });
}

export interface VlmClient {
  analyzeFrame(opts: AnalyzeFrameOptions): Promise<AnalyzeFrameResult>;
  readonly backend: "lmstudio" | "nim" | "poi-brain";
}
