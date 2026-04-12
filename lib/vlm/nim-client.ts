import OpenAI from "openai";
import {
  AnalyzeFrameOptions,
  AnalyzeFrameResult,
  FRAME_EVENTS_SCHEMA,
  VlmClient,
  buildPrompt,
  extractJson,
  toDataUrl,
} from "./shared";

const VLM_BASE_URL =
  process.env.LMSTUDIO_BASE_URL ?? "http://192.168.3.37:1234/v1";
const VLM_MODEL =
  process.env.LMSTUDIO_MODEL ?? "google/gemma-4-26b-a4b";
const VLM_API_KEY = process.env.LMSTUDIO_API_KEY ?? "lm-studio";

const vlm = new OpenAI({
  baseURL: VLM_BASE_URL,
  apiKey: VLM_API_KEY,
});

async function analyzeFrame(
  opts: AnalyzeFrameOptions
): Promise<AnalyzeFrameResult> {
  if (!opts.base64Image) throw new Error("No image data provided");

  const imageUrl = toDataUrl(opts.base64Image);
  const prompt = buildPrompt(opts);

  console.log(
    "[vlm] Sending frame to",
    VLM_BASE_URL,
    "model:",
    VLM_MODEL,
    opts.cameraId ? `camera=${opts.cameraId}` : ""
  );

  let completion;
  try {
    completion = await vlm.chat.completions.create({
      model: VLM_MODEL,
      temperature: 0.1,
      max_tokens: 800,
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
    const anyErr = err as { status?: number; message?: string; error?: unknown };
    console.error(
      "[vlm] Request failed:",
      anyErr.status ?? "?",
      anyErr.message,
      anyErr.error
    );
    throw err;
  }

  const choice = completion.choices?.[0];
  const text = choice?.message?.content ?? "";
  if (!text) return { events: [], rawResponse: "" };

  try {
    const parsed = JSON.parse(extractJson(text));
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      rawResponse: text,
      riskScoreAtTime: opts.riskContext?.score,
    };
  } catch (parseError) {
    console.error("[vlm] JSON parse failed:", parseError);
    return { events: [], rawResponse: text };
  }
}

export const nimClient: VlmClient = {
  backend: "nim",
  analyzeFrame,
};
