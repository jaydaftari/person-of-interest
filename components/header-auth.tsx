import { Badge } from "./ui/badge";

/**
 * Auth has been stripped from this demo build. The original sign-in /
 * sign-out UI has been replaced with a static "Local demo" badge so the
 * layout still renders something in the header-auth slot without touching
 * Supabase. Re-add the original component to restore full auth.
 */
export default function AuthButton() {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="font-normal pointer-events-none">
        Local demo · auth disabled
      </Badge>
    </div>
  );
}
