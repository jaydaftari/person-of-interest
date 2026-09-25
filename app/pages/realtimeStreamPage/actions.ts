"use server";

import { getVlmClient } from "@/lib/vlm";
import type { FrameEvent, RiskContext } from "@/lib/vlm/shared";
import { validateFrameEvents } from "@/lib/vlm/shared";

export type VideoEvent = FrameEvent;

export async function detectEvents(
  base64Image: string,
  transcript: string = "",
  cameraId?: string,
  riskContext?: RiskContext
): Promise<{ events: VideoEvent[]; rawResponse: string; riskScoreAtTime?: number; error?: string }> {
  console.log("Starting frame analysis (realtime stream)...");
  try {
    const result = await getVlmClient().analyzeFrame({
      base64Image,
      transcript,
      cameraId,
      riskContext,
    });
    return { ...result, events: validateFrameEvents(result.events) };
  } catch (error) {
    console.warn("Frame analysis skipped:", error);
    return {
      events: [],
      rawResponse: "",
      error: "Frame analysis failed or returned unreliable text. This frame was skipped; the next frame will be tried automatically.",
    };
  }
}
