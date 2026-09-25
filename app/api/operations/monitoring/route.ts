import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const url = () =>
  `${process.env.POI_BRAIN_URL ?? "http://127.0.0.1:8080"}/operations/monitoring`;

export async function GET() {
  try {
    const response = await fetch(url(), {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return NextResponse.json(await response.json(), {
      status: response.status,
    });
  } catch {
    return NextResponse.json(
      { error: "Monitoring service unavailable" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(url(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return NextResponse.json(await response.json(), {
      status: response.status,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not confirm the change. Check monitoring status before retrying.",
      },
      { status: 502 },
    );
  }
}
