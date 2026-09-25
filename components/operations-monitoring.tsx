"use client";
import { useState } from "react";
import type { Camera } from "@/types";
import type { MonitoringState } from "@/lib/hooks/useOperationsMonitoring";
import { MonitoringAlerts } from "./monitoring-alerts";

interface Props {
  data: MonitoringState | null;
  error: string | null;
  busy: boolean;
  busyAction: "start" | "stop" | "acknowledge" | null;
  connected: boolean;
  selectedCamera?: Camera;
  zoneCameraIds: string[];
  command: (body: Record<string, unknown>) => Promise<void>;
  onShowActivity: () => void;
}

export function MonitoringControls({
  data,
  error,
  busy,
  busyAction,
  connected,
  selectedCamera,
  zoneCameraIds,
  command,
  onShowActivity,
}: Props) {
  const [interval, setInterval] = useState(30);
  const session = data?.monitoring;
  const running = session?.status === "running";
  const unavailable = !connected;
  const start = (ids: string[], label: string) => {
    onShowActivity();
    void command({
      action: "start",
      cameraIds: ids,
      intervalSeconds: interval,
      label,
    });
  };
  return (
    <section className="shrink-0 space-y-2 border-b border-white/15 bg-black/40 p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onShowActivity}
          className="text-left font-semibold uppercase tracking-wide text-amber-300"
        >
          Zone monitoring
        </button>
        <span
          role="status"
          className={
            unavailable
              ? "text-amber-300"
              : running
                ? "text-emerald-300"
                : "text-white/50"
          }
        >
          {busyAction
            ? busyAction === "start"
              ? "Starting…"
              : busyAction === "stop"
                ? "Stopping…"
                : "Acknowledging…"
            : unavailable
              ? "Status unknown"
              : running
                ? `● ${session.phase}`
                : "Stopped"}
        </span>
      </div>
      <p className="text-white/60">
        {running
          ? `${session.cameras.length} camera${session.cameras.length === 1 ? "" : "s"} · ${session.completed} analyses · ${session.failed} failed`
          : "Opt in to 1–3 cameras. One analysis at a time."}
      </p>
      {!!data?.unacknowledgedAlertCount && (
        <div role="alert">
          <button
            onClick={onShowActivity}
            className="w-full rounded border border-amber-400 bg-amber-400/15 p-2 text-left font-semibold text-amber-200"
          >
            ⚠ {data.unacknowledgedAlertCount} potential hazard{" "}
            {data.unacknowledgedAlertCount === 1 ? "alert" : "alerts"} — review
          </button>
        </div>
      )}
      {data?.alertHistoryError && (
        <p role="alert" className="text-amber-300">
          {data.alertHistoryError}
        </p>
      )}
      {session?.observations.some((observation) => observation.alertError) && (
        <button
          onClick={onShowActivity}
          className="w-full text-left text-amber-200"
        >
          Potential hazard flagged but alert storage failed — open Monitoring to
          review.
        </button>
      )}
      {running ? (
        <button
          disabled={busy}
          onClick={() => void command({ action: "stop" })}
          className="w-full rounded border border-red-400/60 bg-red-400/10 px-3 py-2 font-semibold text-red-200 disabled:opacity-40"
        >
          {busyAction === "stop" ? "Stopping…" : "■ Stop monitoring"}
        </button>
      ) : (
        <>
          <label className="flex items-center justify-between gap-2 text-white/60">
            Pause after each camera
            <select
              value={interval}
              disabled={busy}
              onChange={(e) => setInterval(Number(e.target.value))}
              className="rounded border border-white/20 bg-[#111114] p-1 text-white"
            >
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
              <option value={120}>2 minutes</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy || unavailable || !selectedCamera}
              title={selectedCamera?.name ?? "Select a camera on the map first"}
              onClick={() =>
                selectedCamera &&
                start([selectedCamera.id], selectedCamera.name)
              }
              className="flex-1 rounded border border-emerald-400/50 bg-emerald-400/10 px-2 py-2 text-emerald-200 disabled:opacity-40"
            >
              {busyAction === "start" ? "Starting…" : "Start selected camera"}
            </button>
            <button
              disabled={busy || unavailable || zoneCameraIds.length === 0}
              onClick={() =>
                start(zoneCameraIds.slice(0, 3), "Camera search zone")
              }
              className="flex-1 rounded border border-emerald-400/50 bg-emerald-400/10 px-2 py-2 text-emerald-200 disabled:opacity-40"
            >
              Start results ({Math.min(3, zoneCameraIds.length)})
            </button>
          </div>
          {session?.cameraIds.length ? (
            <button
              disabled={busy || unavailable}
              onClick={() => {
                onShowActivity();
                void command({
                  action: "start",
                  cameraIds: session.cameraIds,
                  label: session.label,
                  intervalSeconds: session.intervalSeconds,
                });
              }}
              className="w-full rounded border border-cyan-400/40 px-2 py-2 text-left text-cyan-200 disabled:opacity-40"
            >
              Restart last zone ·{" "}
              {session.cameras.map((c) => c.name).join(", ")}
            </button>
          ) : null}
          {zoneCameraIds.length > 3 && (
            <p className="text-white/50">
              Uses the first 3 search results to stay within budget.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-amber-300">
          {error}
        </p>
      )}
      {data?.legacyBackgroundPolling && (
        <p className="text-amber-300">
          Legacy background analysis is also enabled.
        </p>
      )}
    </section>
  );
}

export function MonitoringActivity({
  data,
  onCameraClick,
  busy,
  command,
}: {
  data: MonitoringState | null;
  onCameraClick: (id: string) => void;
  busy: boolean;
  command: (body: Record<string, unknown>) => Promise<void>;
}) {
  const session = data?.monitoring;
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
      <p className="text-white/60">
        Use historical rankings to choose where to spend limited inference
        capacity. Live observations describe the sampled image; they do not
        establish a crime.
      </p>
      {!data || data.alertHistoryError ? (
        <p className="text-amber-200">
          {data?.alertHistoryError ?? "Loading alert history…"}
        </p>
      ) : (
        <MonitoringAlerts
          alerts={data.alerts ?? []}
          busy={busy}
          retention={data.alertRetentionLimit ?? 100}
          onAcknowledge={(id) =>
            void command({ action: "acknowledge", alertId: id })
          }
          onCameraClick={onCameraClick}
        />
      )}
      {!session ? (
        <p className="text-white/50">
          Find cameras in a zone, then start monitoring with the buttons or ask
          the assistant.
        </p>
      ) : (
        <>
          <div className="space-y-2 rounded border border-white/15 p-3">
            <p className="font-semibold text-amber-200">{session.label}</p>
            {session.cameras.map((camera) => (
              <button
                key={camera.id}
                onClick={() => onCameraClick(camera.id)}
                className="block text-left text-cyan-200 underline underline-offset-2"
              >
                {camera.name}
                {session.currentCameraId === camera.id ? " · analyzing…" : ""}
              </button>
            ))}
            <p className="text-white/50">
              {session.intervalSeconds}s pause after each camera, plus analysis
              time. Cameras are sampled in order.
            </p>
            <p className="text-white/50">
              Started {new Date(session.startedAt).toLocaleTimeString()}
              {session.stoppedAt
                ? ` · Stopped ${new Date(session.stoppedAt).toLocaleTimeString()}`
                : " · Keeps running if you navigate away"}
            </p>
            {session.nextAnalysisAt && (
              <p className="text-white/50">
                Next sample no earlier than{" "}
                {new Date(session.nextAnalysisAt).toLocaleTimeString()}
              </p>
            )}
          </div>
          <p className="text-[10px] uppercase tracking-wide text-white/50">
            Recent observations · {session.completed} completed /{" "}
            {session.failed} failed
          </p>
          {!session.observations.length && (
            <p className="text-white/50">
              {session.status === "running"
                ? "Waiting for the first completed analysis…"
                : "Stopped before an analysis completed."}
            </p>
          )}
          {session.observations.map((observation, index) => (
            <article
              key={`${observation.cameraId}-${observation.analyzedAt ?? observation.attemptedAt}-${index}`}
              className="space-y-2 rounded border border-white/10 bg-black/30 p-3"
            >
              <button
                onClick={() => onCameraClick(observation.cameraId)}
                className="text-left text-cyan-200 underline"
              >
                {observation.cameraName}
              </button>
              <p className="text-[10px] text-white/50">
                {new Date(
                  observation.analyzedAt ??
                    observation.attemptedAt ??
                    session.startedAt,
                ).toLocaleTimeString()}{" "}
                ·{" "}
                {observation.status === "complete"
                  ? "Model observation — review visually"
                  : "Analysis failed"}
              </p>
              <p
                className={`text-[10px] font-semibold ${observation.outcome === "potential_hazard" ? "text-amber-200" : observation.status === "failed" ? "text-amber-300" : "text-white/60"}`}
              >
                {observation.status === "failed"
                  ? "Unknown — analysis failed"
                  : observation.outcome === "potential_hazard" ||
                      observation.events?.some((event) => event.isDangerous)
                    ? "Potential hazard — review required"
                    : "No hazard flagged in this sampled image"}
              </p>
              {observation.alertError && (
                <p role="alert" className="text-amber-200">
                  {observation.alertError}
                </p>
              )}
              {observation.error && (
                <p className="text-amber-300">{observation.error}</p>
              )}
              {observation.events?.map((event, i) => (
                <p key={i} className="text-white/80">
                  {event.description}
                </p>
              ))}
            </article>
          ))}
        </>
      )}
      <p className="text-[10px] text-white/40">
        Stop prevents further snapshots and cancels the pending request. The
        model server may finish an already submitted inference. Recent
        observations stay visible until a new session or backend restart.
        Potential-hazard alerts are retained separately for review.
      </p>
    </div>
  );
}
