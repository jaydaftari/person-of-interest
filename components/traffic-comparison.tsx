"use client";

export interface TrafficComparison {
  startedAt: string;
  finishedAt: string;
  selection: string;
  metric: string;
  coverage: string;
  conclusion: { status: string; cameraIds: string[]; reason: string };
  results: {
    cameraId: string;
    cameraName: string;
    error?: string;
    analyzedAt?: string;
    trafficAssessment?: {
      roadOccupancy: string;
      visibleVehiclesEstimate: number | null;
      confidence: string;
      evidence: string;
    };
    historicalTraffic?: {
      status: string;
      street?: string;
      year?: number;
      samples?: number;
      meanVehiclesPer15Minutes?: number;
      source: string;
      detail?: string;
      scope?: string;
    };
  }[];
}

export function TrafficComparisonCard({
  comparison,
  onCameraClick,
}: {
  comparison: TrafficComparison;
  onCameraClick: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-amber-200">
        Snapshot traffic comparison
      </p>
      <p className="text-[10px] text-white/50">{comparison.selection}</p>
      {comparison.results.map((result) => (
        <div
          key={result.cameraId}
          className="space-y-1 rounded border border-white/15 p-2"
        >
          <button
            onClick={() => onCameraClick(result.cameraId)}
            className="text-left text-cyan-200 underline"
          >
            {result.cameraName}
          </button>
          {result.trafficAssessment && (
            <>
              <p className="capitalize">
                {result.trafficAssessment.roadOccupancy} lane occupancy ·{" "}
                {result.trafficAssessment.confidence} confidence
              </p>
              {result.trafficAssessment.visibleVehiclesEstimate != null && (
                <p className="text-white/60">
                  ≈{result.trafficAssessment.visibleVehiclesEstimate} visible
                  vehicles (model estimate)
                </p>
              )}
              <p>{result.trafficAssessment.evidence}</p>
              <p className="text-[10px] text-white/40">
                Analyzed{" "}
                {result.analyzedAt &&
                  new Date(result.analyzedAt).toLocaleTimeString()}
              </p>
            </>
          )}
          {result.error && <p className="text-amber-300">{result.error}</p>}
          {result.historicalTraffic?.status === "available" ? (
            <p className="text-[10px] text-white/60">
              <a
                href={result.historicalTraffic.source}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                NYC DOT counts
              </a>
              : {result.historicalTraffic.street},{" "}
              {result.historicalTraffic.year} · average{" "}
              {result.historicalTraffic.meanVehiclesPer15Minutes} vehicles / 15
              min across {result.historicalTraffic.samples} recorded samples.
              Street-level historical context; not necessarily this intersection
              or today’s flow.
            </p>
          ) : (
            <p className="text-[10px] text-amber-200/70">
              {result.historicalTraffic?.detail ??
                "Historical counts unavailable."}
            </p>
          )}
        </div>
      ))}
      <p className="text-[10px] text-white/60">
        {comparison.conclusion.reason}
      </p>
      <p className="text-[10px] text-white/50">{comparison.coverage}</p>
    </div>
  );
}
