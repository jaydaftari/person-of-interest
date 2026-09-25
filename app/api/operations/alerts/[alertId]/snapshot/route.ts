import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ alertId: string }> },
) {
  const { alertId } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(alertId))
    return new NextResponse("Alert not found", { status: 404 });
  try {
    const response = await fetch(
      `${process.env.POI_BRAIN_URL ?? "http://127.0.0.1:8080"}/operations/alerts/${alertId}/snapshot`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      return new NextResponse("Captured image unavailable", {
        status: response.status,
      });
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new NextResponse("Captured image unavailable", { status: 502 });
  }
}
