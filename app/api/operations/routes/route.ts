import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function GET() {
  try {
    const response = await fetch(
      `${process.env.POI_BRAIN_URL ?? "http://127.0.0.1:8080"}/operations/routes`,
      { cache: "no-store" },
    );
    return NextResponse.json(await response.json(), {
      status: response.status,
    });
  } catch {
    return NextResponse.json(
      { error: "Route service unavailable" },
      { status: 502 },
    );
  }
}
