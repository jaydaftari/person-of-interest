import { NextResponse, type NextRequest } from "next/server";

// Auth has been stripped from this demo build. The middleware is a pure
// pass-through so every request goes straight to the app without touching
// Supabase. Re-enable `utils/supabase/middleware.ts` if you need session
// refresh and protected-route redirects again.
export async function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
