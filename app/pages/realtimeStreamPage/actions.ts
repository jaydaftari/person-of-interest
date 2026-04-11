"use server";

import { analyzeFrame, type FrameEvent } from "@/lib/lmstudio";

export type VideoEvent = FrameEvent;

export async function detectEvents(
  base64Image: string,
  transcript: string = ""
): Promise<{ events: VideoEvent[]; rawResponse: string }> {
  console.log("Starting frame analysis (realtime stream)...");
  try {
    return await analyzeFrame({ base64Image, transcript });
  } catch (error) {
    console.error("Error in detectEvents:", error);
    throw error;
  }
}
