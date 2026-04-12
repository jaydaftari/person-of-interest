"use client";

import { useMemo, useState } from "react";
import { useCameras } from "@/lib/hooks/useCameras";
import { useHeatmap } from "@/lib/hooks/useHeatmap";
import { useRiskStream } from "@/lib/hooks/useRiskStream";
import { useForecastStats } from "@/lib/hooks/useForecastStats";
import { usePatrolRoutes } from "@/lib/hooks/usePatrolRoutes";
import { useBrainHealth } from "@/lib/hooks/useBrainHealth";
import { useCategories } from "@/lib/hooks/useCategories";
import { RiskHeatmapMap } from "@/components/risk-heatmap-map";
import { CameraFloat } from "@/components/camera-float";
import { ForecastPanel } from "@/components/forecast-panel";
import { RiskBadge } from "@/components/risk-badge";
import { CategoryPicker } from "@/components/category-picker";
import { events as demoEvents } from "@/lib/data";
import { EventFeed } from "@/components/event-feed";
import { TIER_COLOR } from "@/lib/risk/tier";
import type { HazardCategoryId } from "@/types";

export default function MissionControlPage() {
  const [category, setCategory] = useState<HazardCategoryId>("all");
  const categories = useCategories();
  const { cameras, source } = useCameras();
  const { heatmap, loading: heatmapLoading, error: heatmapError } = useHeatmap(9, category);
  const { risksByCamera, connected } = useRiskStream();
  const { stats } = useForecastStats(category);
  const { routes } = usePatrolRoutes();
  const health = useBrainHealth();

  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [eventFeedOpen, setEventFeedOpen] = useState(true);

  const visibleCameras = useMemo(() => {
    const withGeo = cameras.filter((c) => c.latLng);
    const withRisk = withGeo
      .map((c) => ({ cam: c, risk: risksByCamera[c.id] }))
      .sort((a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0));
    return withRisk;
  }, [cameras, risksByCamera]);

  const topCameras = visibleCameras.slice(0, 8);

  const modelBackend = health?.vlmBackend ?? "nim";
  const rapidsOn = health?.rapids ?? false;
  const mlBackend = health?.ml?.backend ?? "—";
  const torchDevice = health?.ml?.torchDevice ?? "—";
  const hasMps = health?.ml?.mpsAvailable ?? false;
  const hasCuda = health?.ml?.cudaAvailable ?? false;

  return (
    <div className="fixed inset-0 bg-deck-bg text-deck-fg">
      <RiskHeatmapMap
        cameras={cameras}
        heatmap={heatmap}
        risksByCamera={risksByCamera}
        patrolRoutes={routes}
        selectedCameraId={selectedCameraId}
        onCameraClick={setSelectedCameraId}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
        <div className="pointer-events-auto rounded-md border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-md">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.18em] text-deck-signal">
            <span className="h-px w-6 bg-deck-signal" />
            /mission-control — deck/00
          </div>
          <div className="mt-1 text-lg font-bold uppercase tracking-tight text-deck-fg">
            PERSON OF INTEREST
          </div>
          <div className="text-[9px] uppercase tracking-widest text-white/40">
            NYC-native predictive surveillance ·
            <span
              className={`ml-1 ${
                source === "poi-brain" ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {source === "poi-brain" ? "brain online" : "local fallback"}
            </span>
            <span
              className={`ml-2 ${
                connected ? "text-emerald-400" : "text-white/30"
              }`}
            >
              · sse {connected ? "live" : "idle"}
            </span>
            {health?.ok && (
              <span className="ml-2 text-emerald-400">
                · nim {health.nimModel ? "loaded" : "offline"}
              </span>
            )}
            {health?.ok === false && (
              <span className="ml-2 text-amber-400">· brain unreachable</span>
            )}
          </div>
          {health?.ok && (
            <div className="mt-1 flex items-center gap-2 text-[8px] uppercase tracking-[0.16em] text-white/40">
              <span>ml</span>
              <span
                className={
                  mlBackend === "cuml-xgb"
                    ? "text-[#76b900]"
                    : mlBackend === "torch"
                      ? "text-cyan-300"
                      : "text-white/60"
                }
              >
                {mlBackend}
              </span>
              <span className="text-white/20">·</span>
              <span>dev</span>
              <span
                className={
                  torchDevice === "cuda"
                    ? "text-[#76b900]"
                    : torchDevice === "mps"
                      ? "text-cyan-300"
                      : "text-white/50"
                }
              >
                {torchDevice}
              </span>
              {(hasCuda || hasMps) && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-white/50">
                    {hasCuda ? "cuda ✓" : hasMps ? "mps ✓" : ""}
                  </span>
                </>
              )}
              {health.platform?.os && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-white/50">
                    {health.platform.os}-{health.platform.arch}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <ForecastPanel stats={stats} vlmBackend={modelBackend} />
          <CategoryPicker
            categories={categories}
            value={category}
            onChange={setCategory}
          />
        </div>
      </header>

      <aside className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-[260px] flex-col gap-2 overflow-y-auto p-4 pt-28">
        <div className="pointer-events-auto mb-1 flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-white/50">
          <span>watch list · top {topCameras.length}</span>
          <span className="tabular-nums text-white/30">
            {cameras.length.toString().padStart(3, "0")} nodes
          </span>
        </div>
        <div className="pointer-events-auto space-y-2">
          {topCameras.map(({ cam, risk }) => (
            <CameraFloat
              key={cam.id}
              camera={cam}
              risk={risk}
              selected={selectedCameraId === cam.id}
              onClick={() => setSelectedCameraId(cam.id)}
            />
          ))}
          {topCameras.length === 0 && (
            <div className="rounded-md border border-white/10 bg-black/60 p-3 text-[10px] uppercase tracking-wider text-white/40 backdrop-blur-md">
              waiting for poi-brain camera catalog…
            </div>
          )}
        </div>
      </aside>

      <aside
        className={`pointer-events-auto absolute bottom-4 right-4 top-28 z-10 flex w-[340px] flex-col overflow-hidden rounded-md border border-white/10 bg-black/70 backdrop-blur-md transition-transform ${
          eventFeedOpen ? "translate-x-0" : "translate-x-[92%]"
        }`}
      >
        <button
          type="button"
          onClick={() => setEventFeedOpen((v) => !v)}
          className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-left"
        >
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">
            EVENT LOG
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-deck-signal">
            {eventFeedOpen ? "hide ›" : "‹ show"}
          </div>
        </button>
        <div className="flex-1 overflow-y-auto p-4">
          <EventFeed
            events={demoEvents}
            videoTimes={{}}
            onEventHover={() => {}}
            onEventClick={(cameraId) => setSelectedCameraId(cameraId)}
          />
        </div>
      </aside>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-4 p-4">
        <div className="pointer-events-auto rounded-md border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-md">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/50">
            NVIDIA Stack
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider">
            <StackPill label="NIM" color="#76b900" dim={!health?.ok} />
            <StackPill label="cuDF" color="#76b900" dim={!rapidsOn} />
            <StackPill label="cuSpatial" color="#76b900" dim={!rapidsOn} />
            <StackPill label="cuML" color="#76b900" dim={!rapidsOn} />
            <StackPill label="cuOpt" color="#76b900" dim={routes.length === 0} />
          </div>
        </div>

        {selectedCameraId &&
          (() => {
            const cam = cameras.find((c) => c.id === selectedCameraId);
            const risk = cam ? risksByCamera[cam.id] : undefined;
            if (!cam) return null;
            return (
              <div className="pointer-events-auto max-w-md rounded-md border border-white/10 bg-black/80 px-4 py-3 backdrop-blur-md">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">
                      SELECTED NODE
                    </div>
                    <div className="mt-0.5 truncate text-sm font-bold uppercase tracking-tight text-white">
                      {cam.name}
                    </div>
                    <div className="truncate text-[10px] text-white/60">
                      {cam.address}
                    </div>
                  </div>
                  {risk && <RiskBadge tier={risk.tier} score={risk.score} />}
                </div>
                {risk?.reasons && risk.reasons.length > 0 && (
                  <div className="mt-2 border-t border-white/10 pt-2">
                    <div className="text-[9px] uppercase tracking-[0.18em] text-white/40">
                      why flagged
                    </div>
                    <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-white/80">
                      {risk.reasons.slice(0, 4).map((r, i) => (
                        <li key={i} className="flex gap-2">
                          <span style={{ color: TIER_COLOR[risk.tier] }}>›</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedCameraId(null)}
                  className="mt-2 text-[9px] uppercase tracking-[0.2em] text-white/40 hover:text-white/80"
                >
                  close
                </button>
              </div>
            );
          })()}
      </footer>

      {heatmapError && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-md border border-red-500/40 bg-black/80 px-3 py-2 text-[10px] uppercase tracking-wider text-red-400 backdrop-blur-md">
          heatmap unreachable — {heatmapError.message}
        </div>
      )}
      {heatmapLoading && !heatmapError && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-md border border-white/10 bg-black/60 px-3 py-2 text-[10px] uppercase tracking-wider text-white/60 backdrop-blur-md">
          loading risk heatmap…
        </div>
      )}
    </div>
  );
}

function StackPill({
  label,
  color,
  dim,
}: {
  label: string;
  color: string;
  dim?: boolean;
}) {
  return (
    <span
      className="rounded-sm border px-1.5 py-0.5"
      style={{
        borderColor: color,
        color: dim ? `${color}80` : color,
        backgroundColor: `${color}14`,
        opacity: dim ? 0.55 : 1,
      }}
    >
      {label}
    </span>
  );
}
