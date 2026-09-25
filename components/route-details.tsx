"use client";
import type { PatrolRoute } from "@/types";

export function RouteDetails({
  route,
  onCameraClick,
}: {
  route: PatrolRoute;
  onCameraClick?: (id: string) => void;
}) {
  const ready = route.status === "ready";
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-cyan-300">
          {route.unitId === "selected-route"
            ? "Selected camera route"
            : route.unitId}
        </strong>
        <span className={ready ? "text-emerald-300" : "text-amber-300"}>
          {ready ? "Road route" : "Unavailable"}
        </span>
      </div>
      {ready ? (
        <p>
          {((route.distanceMeters ?? 0) / 1000).toFixed(1)} km ·{" "}
          {Math.ceil((route.durationSeconds ?? 0) / 60)} min estimated driving
        </p>
      ) : (
        <p className="text-amber-300">
          {route.error ?? "Waiting for road directions."}
        </p>
      )}
      <p className="text-[10px] text-white/50">
        {route.solverMetadata.solverBackend === "selected-order"
          ? "Stops follow your selected order."
          : "Suggested stops for a simulated unit; 30-minute driving budget."}{" "}
        Estimates exclude live traffic and time spent at stops.
      </p>
      <ol className="space-y-3 border-l border-cyan-500/30 pl-3">
        {route.waypoints.map((stop, i) => (
          <li key={`${i}-${stop.cameraId ?? stop.h3Cell}`}>
            <div className="flex items-start justify-between gap-2">
              {stop.cameraId ? (
                <button
                  type="button"
                  onClick={() => onCameraClick?.(stop.cameraId!)}
                  className="text-left text-cyan-200 underline underline-offset-2"
                >
                  {i + 1}. {stop.name ?? stop.cameraId}
                </button>
              ) : (
                <span>
                  {i + 1}. {stop.name ?? "Starting point"}
                </span>
              )}
              <span className="shrink-0 text-white/50">
                {ready && stop.etaSeconds != null
                  ? `+${Math.ceil(stop.etaSeconds / 60)}m`
                  : "—"}
              </span>
            </div>
            {!!stop.reasons?.length && (
              <p className="mt-1 text-[10px] leading-relaxed text-white/60">
                {stop.reasons.join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="text-[10px] text-white/40">
        Historical context is not evidence of a current incident.{" "}
        {route.generatedAt &&
          `Calculated ${new Date(route.generatedAt).toLocaleTimeString()}.`}
      </p>
      <p className="text-[10px] text-white/50">
        <a
          href="https://project-osrm.org/"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          OSRM
        </a>{" "}
        · ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          OpenStreetMap contributors
        </a>{" "}
        ·{" "}
        <a
          href="https://www.openstreetmap.org/fixthemap"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Fix the map
        </a>
      </p>
    </div>
  );
}
