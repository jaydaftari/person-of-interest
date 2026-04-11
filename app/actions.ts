"use server";

import { redirect } from "next/navigation";
import { encodedRedirect } from "@/utils/utils";

// -----------------------------------------------------------------------------
// Auth has been stripped from this demo build.
//
// These server actions were originally backed by Supabase. They're kept as
// no-op stubs so the existing imports in app/(auth-pages)/* and
// app/protected/reset-password/page.tsx continue to compile. The stubs
// never touch Supabase and either redirect straight to the dashboard or
// surface a short "disabled" message back to the form.
// -----------------------------------------------------------------------------

export const signUpAction = async (_formData: FormData) => {
  return encodedRedirect(
    "error",
    "/sign-up",
    "Auth is disabled in this local demo build."
  );
};

export const signInAction = async (_formData: FormData) => {
  // Pretend the sign-in succeeded and drop the user on the dashboard.
  return redirect("/protected");
};

export const forgotPasswordAction = async (_formData: FormData) => {
  return encodedRedirect(
    "error",
    "/forgot-password",
    "Auth is disabled in this local demo build."
  );
};

export const resetPasswordAction = async (_formData: FormData) => {
  return encodedRedirect(
    "error",
    "/protected/reset-password",
    "Auth is disabled in this local demo build."
  );
};

export const signOutAction = async () => {
  return redirect("/");
};
