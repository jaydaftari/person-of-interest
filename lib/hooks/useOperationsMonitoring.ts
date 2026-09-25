"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface MonitoringAlert {
  id: string;
  sessionId: string;
  cameraId: string;
  cameraName: string;
  analyzedAt: string;
  snapshotAt: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  events: { description: string; isDangerous: boolean }[];
  source: string | null;
  imageAvailable: boolean;
  snapshotPath: string | null;
}

export interface MonitoringState {
  monitoring: {
    id: string;
    label: string;
    status: "running" | "stopped";
    phase: "queued" | "analyzing" | "waiting" | "idle";
    cameraIds: string[];
    cameras: { id: string; name: string }[];
    intervalSeconds: number;
    currentCameraId: string | null;
    nextAnalysisAt: string | null;
    startedAt: string;
    stoppedAt: string | null;
    completed: number;
    failed: number;
    observations: {
      cameraId: string;
      cameraName: string;
      status: "complete" | "failed";
      outcome?: "potential_hazard" | "no_hazard_flagged" | "analysis_failed";
      alertId?: string;
      alertError?: string;
      error?: string;
      analyzedAt?: string;
      attemptedAt?: string;
      snapshotAt?: string;
      events?: { description: string; isDangerous: boolean }[];
    }[];
  } | null;
  alerts?: MonitoringAlert[];
  unacknowledgedAlertCount?: number;
  alertHistoryError?: string | null;
  alertRetentionLimit?: number;
  limits: {
    maxCameras: number;
    concurrency: number;
    minIntervalSeconds: number;
  };
  legacyBackgroundPolling: boolean;
}

export function useOperationsMonitoring() {
  const [data, setData] = useState<MonitoringState | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<
    "start" | "stop" | "acknowledge" | null
  >(null);
  const version = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    const requestVersion = ++version.current;
    try {
      const response = await fetch("/api/operations/monitoring", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(
          "Monitoring status unavailable. Last known state shown.",
        );
      const state: MonitoringState = await response.json();
      if (mounted.current && version.current === requestVersion) {
        setData(state);
        setPollError(null);
      }
    } catch (e) {
      if (mounted.current && version.current === requestVersion)
        setPollError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const poll = async () => {
      await refresh();
      if (active) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => {
      active = false;
      mounted.current = false;
      ++version.current;
      clearTimeout(timer);
    };
  }, [refresh]);

  const command = async (body: Record<string, unknown>) => {
    if (pending.current) return;
    pending.current = true;
    ++version.current;
    setBusy(true);
    setBusyAction(
      body.action === "acknowledge"
        ? "acknowledge"
        : body.action === "stop"
          ? "stop"
          : "start",
    );
    setActionError(null);
    try {
      const response = await fetch("/api/operations/monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : (result.error ?? "Monitoring change failed"),
        );
      if (mounted.current) {
        setData(result);
        setPollError(null);
      }
    } catch (e) {
      if (mounted.current) setActionError((e as Error).message);
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        setBusyAction(null);
        void refresh();
      }
    }
  };
  return {
    data,
    error: actionError ?? pollError,
    connected: !!data && !pollError,
    busy,
    busyAction,
    refresh,
    command,
  };
}
