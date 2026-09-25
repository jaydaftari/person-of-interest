import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(
      `${process.env.POI_BRAIN_URL ?? "http://127.0.0.1:8080"}/operations/assistant/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: request.signal,
        cache: "no-store",
      },
    );
    if (!response.ok)
      return NextResponse.json(
        {
          error:
            "Assistant request rejected. Check your message and try again.",
        },
        { status: response.status },
      );
    return new Response(response.body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Camera backend is unavailable." },
      { status: 502 },
    );
  }
}
