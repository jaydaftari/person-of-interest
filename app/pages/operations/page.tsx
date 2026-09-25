"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useOperationsCameras } from "@/lib/hooks/useOperationsCameras";
import { useHeatmap } from "@/lib/hooks/useHeatmap";
import { useRiskStream } from "@/lib/hooks/useRiskStream";
import { useOperationsRoutes } from "@/lib/hooks/useOperationsRoutes";
import { useBrainHealth } from "@/lib/hooks/useBrainHealth";
import { useCategories } from "@/lib/hooks/useCategories";
import { OperationsMap } from "@/components/operations-map";
import { OperationsCameraFloat } from "@/components/operations-camera-float";
import { CategoryPicker } from "@/components/category-picker";
import { OperationsCameraPopup } from "@/components/operations-camera-popup";
import { MapAssistant } from "@/components/map-assistant";
import {
  MonitoringControls,
  MonitoringActivity,
} from "@/components/operations-monitoring";
import { useOperationsMonitoring } from "@/lib/hooks/useOperationsMonitoring";
import type { HazardCategoryId, PatrolRoute } from "@/types";

export default function OperationsPage() {
  const [category, setCategory] = useState<HazardCategoryId>("all");
  const categories = useCategories();
  const { cameras, source, error: cameraError } = useOperationsCameras();
  const { heatmap, loading, error: heatmapError } = useHeatmap(9, category);
  const { risksByCamera, connected } = useRiskStream();
  const { routes } = useOperationsRoutes();
  const health = useBrainHealth();
  const monitoring = useOperationsMonitoring();
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [customRoute, setCustomRoute] = useState<PatrolRoute | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [tab, setTab] = useState<"assistant" | "monitoring">("assistant");
  const allRoutes = useMemo(
    () =>
      customRoute
        ? [
            customRoute,
            ...routes.filter((r) => r.unitId !== customRoute.unitId),
          ]
        : routes,
    [routes, customRoute],
  );
  const selectedRoute = allRoutes.find((r) => r.unitId === selectedRouteId);
  const topCameras = useMemo(() => {
    const candidates = highlighted.length
      ? cameras.filter((c) => highlighted.includes(c.id))
      : cameras;
    return candidates
      .filter((c) => c.latLng)
      .map((cam) => ({ cam, risk: risksByCamera[cam.id] }))
      .sort((a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0))
      .slice(0, 8);
  }, [cameras, risksByCamera, highlighted]);
  const selectCamera = (id: string) => {
    setSelectedCameraId(id);
    setPopupOpen(true);
  };
  const selectRoute = (id: string) => {
    setSelectedRouteId(id);
    setTab("assistant");
  };

  return (
    <div className="fixed inset-0 z-30 flex h-dvh flex-col overflow-hidden bg-deck-bg text-deck-fg">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/80 px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-amber-400">
            DECK/07 · Operations
          </div>
          <h1 className="text-lg">CAMERA OPERATIONS</h1>
        </div>
        <div className="hidden text-[10px] text-white/50 lg:block">
          {cameras.length} cameras · {heatmap?.cells.length ?? "—"} historical
          cells · {health?.ml?.backend ?? "—"}/{health?.ml?.torchDevice ?? "—"}
          <br />
          <span
            className={
              source === "poi-brain" ? "text-emerald-300" : "text-amber-300"
            }
          >
            {source === "poi-brain"
              ? "Backend connected"
              : "Backend unavailable"}
          </span>{" "}
          · risk stream {connected ? "live" : "connecting"}
        </div>
        <nav className="flex gap-4 text-xs">
          <Link href="/protected" className="hover:text-amber-400">
            Protected
          </Link>
          <Link href="/pages/nyctmc" className="hover:text-amber-400">
            NYC Deck
          </Link>
          <Link href="/pages/map" className="hover:text-amber-400">
            Map
          </Link>
        </nav>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[240px_minmax(0,1fr)_370px]">
        <aside className="hidden min-h-0 overflow-y-auto border-r border-white/10 p-2 xl:block">
          <div className="mb-2 flex items-center justify-between px-1 text-[10px] uppercase text-white/50">
            <span>
              {highlighted.length ? "Search results" : "Historical watch list"}
            </span>
            {highlighted.length > 0 && (
              <button
                onClick={() => setHighlighted([])}
                className="text-amber-300"
              >
                Clear
              </button>
            )}
          </div>
          <div className="space-y-2">
            {topCameras.map(({ cam, risk }) => (
              <OperationsCameraFloat
                key={cam.id}
                camera={cam}
                risk={risk}
                selected={selectedCameraId === cam.id}
                onClick={() => selectCamera(cam.id)}
              />
            ))}
          </div>
        </aside>
        <section className="relative min-h-0 min-w-0 overflow-hidden">
          <OperationsMap
            cameras={cameras}
            heatmap={heatmap}
            risksByCamera={risksByCamera}
            patrolRoutes={selectedRoute ? [selectedRoute] : []}
            selectedCameraId={selectedCameraId}
            selectedRouteId={selectedRouteId}
            highlightedCameraIds={highlighted}
            onCameraClick={selectCamera}
            onRouteClick={selectRoute}
          />
          <div className="absolute left-3 top-3 z-10 max-w-[90%]">
            <CategoryPicker
              categories={categories}
              value={category}
              onChange={setCategory}
            />
          </div>
          <div className="pointer-events-none absolute bottom-8 left-3 right-3 z-10 text-[10px]">
            <span className="rounded bg-black/80 px-2 py-1 text-white/70">
              Heatmap: historical ranking
              {selectedRoute
                ? " · Amber line: selected road route"
                : " · Ask the assistant to compare or plan routes"}
            </span>
          </div>
          {(heatmapError || cameraError || loading) && (
            <div className="absolute bottom-16 left-3 right-3 rounded bg-black/90 p-2 text-xs text-amber-300">
              {heatmapError
                ? "Historical heatmap unavailable"
                : cameraError
                  ? "Camera backend unavailable; showing the last loaded catalog"
                  : "Loading historical context…"}
            </div>
          )}
        </section>
        <aside className="flex min-h-0 min-w-0 flex-col border-l border-white/10 bg-[#111114]">
          <MonitoringControls
            data={monitoring.data}
            error={monitoring.error}
            busy={monitoring.busy}
            busyAction={monitoring.busyAction}
            connected={monitoring.connected}
            selectedCamera={cameras.find((c) => c.id === selectedCameraId)}
            zoneCameraIds={highlighted}
            command={monitoring.command}
            onShowActivity={() => setTab("monitoring")}
          />
          <div className="flex shrink-0 border-b border-white/10">
            {(["assistant", "monitoring"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-3 text-xs font-bold uppercase tracking-wider ${tab === t ? "border-b-2 border-amber-400 text-amber-300" : "text-white/50"}`}
              >
                {t === "assistant"
                  ? "Assistant"
                  : `Monitoring${monitoring.data?.unacknowledgedAlertCount ? ` (${monitoring.data.unacknowledgedAlertCount})` : ""}`}
              </button>
            ))}
          </div>
          <div
            className={`${tab === "assistant" ? "flex" : "hidden"} min-h-0 flex-1 flex-col`}
          >
            <MapAssistant
              selectedCameraId={selectedCameraId}
              selectedCameraName={
                cameras.find((c) => c.id === selectedCameraId)?.name
              }
              monitoringBusy={
                monitoring.busy ||
                monitoring.data?.monitoring?.status === "running"
              }
              onMonitorCamera={(id, name) => {
                setSelectedCameraId(id);
                setTab("monitoring");
                void monitoring.command({
                  action: "start",
                  cameraIds: [id],
                  label: name,
                  intervalSeconds: 30,
                });
              }}
              onCameraClick={selectCamera}
              onCamerasFound={setHighlighted}
              onSelectRoute={selectRoute}
              onMonitoringChange={() => void monitoring.refresh()}
              onRoute={(route) => {
                setCustomRoute(route);
                setSelectedRouteId(route.unitId);
              }}
            />
          </div>
          {tab === "monitoring" && (
            <MonitoringActivity
              data={monitoring.data}
              onCameraClick={selectCamera}
              busy={monitoring.busy}
              command={monitoring.command}
            />
          )}
        </aside>
      </div>
      <OperationsCameraPopup
        camera={
          popupOpen
            ? (cameras.find((c) => c.id === selectedCameraId) ?? null)
            : null
        }
        risk={selectedCameraId ? risksByCamera[selectedCameraId] : undefined}
        onClose={() => setPopupOpen(false)}
      />
    </div>
  );
}
