import type {
  Camera,
  ForecastStats,
  HazardCategory,
  HazardCategoryId,
  Heatmap,
  PatrolRoute,
  RiskScore,
} from "@/types";

const POI_BRAIN_URL =
  process.env.NEXT_PUBLIC_POI_BRAIN_URL ?? "http://localhost:8080";

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${POI_BRAIN_URL}${path}`, {
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    throw new Error(`poi-brain ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function fetchCameras(): Promise<Camera[]> {
  return getJson<Camera[]>("/cameras");
}

export async function fetchHeatmap(
  resolution = 9,
  category: HazardCategoryId = "all",
  hourOfWeek?: number
): Promise<Heatmap> {
  const params = new URLSearchParams({
    resolution: String(resolution),
    category,
  });
  if (hourOfWeek !== undefined) {
    params.set("hour_of_week", String(hourOfWeek));
  }
  return getJson<Heatmap>(`/risk/heatmap?${params.toString()}`);
}

export async function fetchCategories(): Promise<HazardCategory[]> {
  return getJson<HazardCategory[]>("/risk/categories");
}

export async function fetchCameraRisk(
  cameraId: string
): Promise<RiskScore | null> {
  try {
    return await getJson<RiskScore>(
      `/risk/camera/${encodeURIComponent(cameraId)}`
    );
  } catch {
    return null;
  }
}

export async function fetchForecastStats(
  category: HazardCategoryId = "all"
): Promise<ForecastStats> {
  return getJson<ForecastStats>(`/stats/forecast?category=${category}`);
}

export async function fetchPatrolRoutes(): Promise<PatrolRoute[]> {
  return getJson<PatrolRoute[]>("/routes/current");
}

export function openRiskStream(
  onMessage: (risk: RiskScore) => void,
  onError?: (ev: Event) => void
): EventSource | null {
  if (typeof window === "undefined") return null;
  const es = new EventSource(`${POI_BRAIN_URL}/risk/stream`);
  es.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch (err) {
      console.error("[risk-stream] parse error", err);
    }
  };
  if (onError) es.onerror = onError;
  return es;
}

export function openCameraStream(
  onMessage: (
    msg: {
      cameraId: string;
      latestThumbB64?: string;
      latestEvents?: Array<{
        timestamp: string;
        description: string;
        isDangerous: boolean;
      }>;
      riskScoreAtTime?: number;
    }
  ) => void
): EventSource | null {
  if (typeof window === "undefined") return null;
  const es = new EventSource(`${POI_BRAIN_URL}/cameras/stream`);
  es.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch (err) {
      console.error("[camera-stream] parse error", err);
    }
  };
  return es;
}

export const POI_BRAIN_BASE_URL = POI_BRAIN_URL;
