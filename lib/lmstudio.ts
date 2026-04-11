import OpenAI from "openai";

/**
 * Shared LM Studio client.
 *
 * LM Studio exposes an OpenAI-compatible server (default: http://localhost:1234/v1).
 * No real API key is required — pass any non-empty string.
 *
 * Configure via env:
 *   LMSTUDIO_BASE_URL  (default: http://localhost:1234/v1)
 *   LMSTUDIO_MODEL     (default: google/gemma-4-26b-a4b)
 *   LMSTUDIO_API_KEY   (default: "lm-studio" — any non-empty string works)
 *
 * Note: LM Studio requires `response_format.type` to be `json_schema` or
 * `text` — it does NOT accept OpenAI's `json_object` shorthand. We use a
 * strict json_schema below which also has the nice side effect of
 * suppressing reasoning tokens on Gemma 4 (major latency win).
 */
export const LMSTUDIO_BASE_URL =
  process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1";
export const LMSTUDIO_MODEL =
  process.env.LMSTUDIO_MODEL ?? "google/gemma-4-26b-a4b";

export const lmstudio = new OpenAI({
  baseURL: LMSTUDIO_BASE_URL,
  apiKey: process.env.LMSTUDIO_API_KEY ?? "lm-studio",
});

export interface FrameEvent {
  timestamp: string;
  description: string;
  isDangerous: boolean;
}

export interface AnalyzeFrameOptions {
  /** Full data URL (e.g. "data:image/jpeg;base64,...") or raw base64 string. */
  base64Image: string;
  /** Optional audio transcript to provide extra context. */
  transcript?: string;
}

export interface AnalyzeFrameResult {
  events: FrameEvent[];
  rawResponse: string;
}

const DETECTION_PROMPT = `Analyze this frame and determine if any of these specific dangerous situations are occurring:

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
- Trespassing`;

const OUTPUT_INSTRUCTIONS = `For each observation in this frame, emit one event with a "mm:ss" timestamp, a brief description, and an isDangerous flag. Set isDangerous=true if the event involves a fall, injury, unease, pain, accident, or concerning behavior; otherwise false. If nothing concerning is visible, still emit at least one event describing the normal scene with isDangerous=false.`;

/** Strict JSON schema for structured output — LM Studio only accepts json_schema/text. */
const FRAME_EVENTS_SCHEMA = {
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

/** Ensures the image is a usable data URL for OpenAI-style image_url content. */
function toDataUrl(input: string): string {
  if (input.startsWith("data:")) return input;
  return `data:image/jpeg;base64,${input}`;
}

/**
 * Fallback extractor for the (rare) case where the server returns
 * surrounding prose instead of strict JSON. `json_schema` mode normally
 * guarantees valid JSON, so this is a belt-and-suspenders guard.
 */
function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1];
  const rawMatch = text.match(/\{[\s\S]*\}/);
  if (rawMatch) return rawMatch[0];
  return text;
}

/**
 * Send a frame to the local LM Studio server (Gemma 4 or any loaded VLM)
 * and parse the structured detection response.
 */
export async function analyzeFrame({
  base64Image,
  transcript,
}: AnalyzeFrameOptions): Promise<AnalyzeFrameResult> {
  if (!base64Image) {
    throw new Error("No image data provided");
  }

  const imageUrl = toDataUrl(base64Image);
  const transcriptLine = transcript
    ? `\nConsider this audio transcript from the scene: "${transcript}"\n`
    : "";
  const prompt = `${DETECTION_PROMPT}${transcriptLine}\n${OUTPUT_INSTRUCTIONS}`;

  console.log(
    "[lmstudio] Sending frame to",
    LMSTUDIO_BASE_URL,
    "model:",
    LMSTUDIO_MODEL
  );

  let completion;
  try {
    completion = await lmstudio.chat.completions.create({
      model: LMSTUDIO_MODEL,
      temperature: 0.1,
      max_tokens: 800,
      // LM Studio only accepts `json_schema` or `text` — NOT `json_object`.
      // Strict schema guarantees valid JSON and suppresses reasoning tokens
      // on Gemma 4, roughly 3x faster per frame.
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "frame_events",
          schema: FRAME_EVENTS_SCHEMA as unknown as Record<string, unknown>,
          strict: true,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });
  } catch (err) {
    // Log the server-side error body for diagnostics.
    const anyErr = err as { status?: number; message?: string; error?: unknown };
    console.error(
      "[lmstudio] Request failed:",
      anyErr.status ?? "?",
      anyErr.message,
      anyErr.error
    );
    throw err;
  }

  const choice = completion.choices?.[0];
  const finishReason = choice?.finish_reason;
  const text = choice?.message?.content ?? "";

  console.log(
    "[lmstudio] Response — finish_reason:",
    finishReason,
    "content_length:",
    text.length
  );
  console.log("[lmstudio] Raw content:", text.slice(0, 1000));

  if (!text) {
    console.error(
      "[lmstudio] Empty response. Full completion:",
      JSON.stringify(completion, null, 2)
    );
    // Return a safe empty result rather than crashing the server action.
    return { events: [], rawResponse: "" };
  }

  try {
    const parsed = JSON.parse(extractJson(text));
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      rawResponse: text,
    };
  } catch (parseError) {
    console.error(
      "[lmstudio] JSON parse failed. finish_reason:",
      finishReason,
      "\nraw content:",
      text,
      "\nparse error:",
      parseError
    );
    // Don't crash the caller — return empty events so the UI keeps streaming.
    return { events: [], rawResponse: text };
  }
}
