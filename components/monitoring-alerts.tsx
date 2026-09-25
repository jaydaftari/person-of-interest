"use client";

import { useState } from "react";
import type { MonitoringAlert } from "@/lib/hooks/useOperationsMonitoring";

function AlertCard({
  alert,
  busy,
  onAcknowledge,
  onCameraClick,
}: {
  alert: MonitoringAlert;
  busy: boolean;
  onAcknowledge: (id: string) => void;
  onCameraClick: (id: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const pending = !alert.acknowledgedAt;
  return (
    <article
      id={`alert-${alert.id}`}
      className={`space-y-2 rounded border p-3 ${pending ? "border-amber-400/70 bg-amber-400/10" : "border-white/15 bg-black/30"}`}
    >
      <p
        className={`font-semibold ${pending ? "text-amber-200" : "text-white/60"}`}
      >
        {pending
          ? "Potential hazard — review required"
          : "Acknowledged potential hazard"}
      </p>
      <button
        onClick={() => onCameraClick(alert.cameraId)}
        className="text-left text-cyan-200 underline underline-offset-2"
      >
        {alert.cameraName}
      </button>
      {alert.snapshotPath && !imageFailed ? (
        <a
          href={alert.snapshotPath}
          target="_blank"
          rel="noreferrer"
          className="block"
          title="Open the captured image"
        >
          {/* Exact saved snapshot; deliberately not the current camera feed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={alert.snapshotPath}
            alt={`Captured frame flagged for review at ${alert.cameraName}`}
            onError={() => setImageFailed(true)}
            className="aspect-video w-full rounded bg-black object-contain"
            loading="lazy"
          />
        </a>
      ) : (
        <p className="rounded bg-black/30 p-2 text-amber-200">
          Captured image unavailable. The model description alone cannot verify
          this alert.
        </p>
      )}
      <div className="text-[10px] text-white/60">
        <p>
          Snapshot fetched{" "}
          {alert.snapshotAt
            ? new Date(alert.snapshotAt).toLocaleString()
            : "at an unknown time"}
        </p>
        <p>Analyzed {new Date(alert.analyzedAt).toLocaleString()}</p>
      </div>
      <p className="text-[10px] uppercase text-white/50">
        Why it was flagged · model interpretation
      </p>
      {alert.events.map((event, index) => (
        <p key={index} className="text-white/90">
          {event.description}
        </p>
      ))}
      <p className="text-[10px] text-white/50">
        Source: captured NYC DOT camera snapshot. The model flagged a possible
        visible hazard; this is not a confirmed incident. Fetch time may differ
        from camera capture time.
      </p>
      {pending ? (
        <button
          disabled={busy}
          onClick={() => onAcknowledge(alert.id)}
          className="w-full rounded border border-amber-300/60 px-3 py-2 font-semibold text-amber-200 disabled:opacity-40"
        >
          Acknowledge — reviewed
        </button>
      ) : (
        <p className="text-[10px] text-white/50">
          Acknowledged {new Date(alert.acknowledgedAt!).toLocaleString()}. This
          records review, not resolution.
        </p>
      )}
    </article>
  );
}

export function MonitoringAlerts({
  alerts,
  busy,
  retention,
  onAcknowledge,
  onCameraClick,
}: {
  alerts: MonitoringAlert[];
  busy: boolean;
  retention: number;
  onAcknowledge: (id: string) => void;
  onCameraClick: (id: string) => void;
}) {
  const pending = alerts.filter((alert) => !alert.acknowledgedAt);
  const reviewed = alerts.filter((alert) => !!alert.acknowledgedAt);
  return (
    <section className="space-y-3" aria-label="Potential hazard alerts">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">
        Alerts requiring review · {pending.length}
      </p>
      {!pending.length && (
        <p className="text-white/50">
          No unacknowledged alerts in the retained history. This does not
          establish that the area is safe.
        </p>
      )}
      {pending.map((alert) => (
        <AlertCard
          key={alert.id}
          alert={alert}
          busy={busy}
          onAcknowledge={onAcknowledge}
          onCameraClick={onCameraClick}
        />
      ))}
      {!!reviewed.length && (
        <details className="space-y-3">
          <summary className="cursor-pointer text-white/60">
            Acknowledged alerts ({reviewed.length})
          </summary>
          {reviewed.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              busy={busy}
              onAcknowledge={onAcknowledge}
              onCameraClick={onCameraClick}
            />
          ))}
        </details>
      )}
      <p className="text-[10px] text-white/40">
        Latest {retention} flagged snapshots retained locally across Stop, new
        monitoring sessions, and backend restarts. Acknowledgment does not stop
        monitoring.
      </p>
    </section>
  );
}
