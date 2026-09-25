"use client";

import { useEffect, useState } from "react";
import type { Camera } from "@/types";

function age(timestamp: string | null | undefined, now: number) {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
  return seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : `${Math.floor(seconds / 3600)}h ago`;
}

export function CameraFreshness({ camera }: { camera: Camera }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  let status = camera.analysisStatus ?? "never";
  if (
    status === "fresh" &&
    camera.lastAnalyzedAt &&
    now - Date.parse(camera.lastAnalyzedAt) > 120000
  )
    status = "stale";
  const label =
    status === "never"
      ? "Not analyzed"
      : status === "fresh"
        ? "Recent analysis"
        : status === "stale"
          ? "Stale analysis"
          : status === "failed"
            ? "Analysis failed"
            : status === "offline"
              ? "Snapshot unavailable"
              : "Analyzing…";
  return (
    <div
      className="space-y-1 text-[10px] leading-snug"
      title={camera.analysisError ?? undefined}
    >
      <div
        className={
          status === "fresh"
            ? "text-emerald-300"
            : status === "never"
              ? "text-white/50"
              : "text-amber-300"
        }
      >
        {label}
      </div>
      <div className="text-white/50">
        Model: {age(camera.lastAnalyzedAt, now)} · Snapshot fetched:{" "}
        {age(camera.lastSnapshotAt, now)}
      </div>
    </div>
  );
}
