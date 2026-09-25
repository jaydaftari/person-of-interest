"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NyctmcCamera } from "@/lib/nyctmc";
import type { FrameEvent } from "@/lib/lmstudio";

interface AnalyzeResponse {
  events: FrameEvent[];
  rawResponse?: string;
}

const CAMERA_LIMIT = 200;
const PAGE_SIZE = 8;
const IMAGE_REFRESH_MS = 5000;

export default function NyctmcPage() {
  const [cameras, setCameras] = useState<NyctmcCamera[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const catalogRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<NyctmcCamera | null>(
    null,
  );
  const [imageSeed, setImageSeed] = useState(Date.now());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeResponse | null>(
    null,
  );
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<Date | null>(null);
  const [transcript, setTranscript] = useState("");
  const [clock, setClock] = useState<string>("");

  // Live clock
  useEffect(() => {
    const update = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", {
          timeZone: "UTC",
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, []);

  // Load cameras
  useEffect(() => {
    const loadCameras = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(
          `/api/nyctmc/cameras?limit=${CAMERA_LIMIT}`,
        );
        if (!response.ok) throw new Error("failed to load camera catalog");
        const data = await response.json();
        setCameras(data.cameras ?? []);
        if (!selectedCamera && data.cameras?.length) {
          setSelectedCamera(data.cameras[0]);
        }
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "unknown error");
      } finally {
        setIsLoading(false);
      }
    };
    loadCameras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame refresh
  useEffect(() => {
    if (!selectedCamera) return;
    const interval = setInterval(
      () => setImageSeed(Date.now()),
      IMAGE_REFRESH_MS,
    );
    return () => clearInterval(interval);
  }, [selectedCamera]);

  const filteredCameras = useMemo(() => {
    if (!search.trim()) return cameras;
    const q = search.toLowerCase();
    return cameras.filter((c) =>
      [c.name, c.area]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [cameras, search]);

  const pageCount = Math.max(1, Math.ceil(filteredCameras.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedCameras = filteredCameras.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    if (catalogRef.current) catalogRef.current.scrollTop = 0;
  }, [currentPage, search]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const selectCamera = (camera: NyctmcCamera) => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIsAnalyzing(false);
    setSelectedCamera(camera);
    setImageSeed(Date.now());
    setAnalysisResult(null);
    setAnalysisError(null);
    setLastAnalyzedAt(null);
  };

  const currentImageUrl = selectedCamera
    ? `${selectedCamera.imageUrl}${selectedCamera.imageUrl.includes("?") ? "&" : "?"}t=${imageSeed}`
    : null;

  const handleAnalyze = async () => {
    if (!selectedCamera || requestRef.current) return;
    const submittedTranscript = transcript.trim();
    const controller = new AbortController();
    requestRef.current = controller;
    setTranscript("");
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    try {
      const response = await fetch("/api/nyctmc/analyze", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cameraId: selectedCamera.id,
          transcript: submittedTranscript || undefined,
        }),
      });
      if (!response.ok) throw new Error("model analysis failed");
      const data: AnalyzeResponse = await response.json();
      if (controller.signal.aborted) return;
      setAnalysisResult(data);
      setLastAnalyzedAt(new Date());
    } catch (err) {
      if (controller.signal.aborted) return;
      setAnalysisError(err instanceof Error ? err.message : "analysis failed");
      // Keep failed notes available for retry without replacing a newly typed draft.
      setTranscript((draft) => draft || submittedTranscript);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsAnalyzing(false);
      }
    }
  };

  const hasDanger = analysisResult?.events?.some((e) => e.isDangerous);
  const selectedIndex = selectedCamera
    ? cameras.findIndex((c) => c.id === selectedCamera.id) + 1
    : 0;

  return (
    <div className="deck-workspace nyctmc-page relative mx-auto w-full max-w-[1600px] px-4 py-3">
      {/* Page header bar */}
      <div className="nyctmc-heading mb-3 flex shrink-0 items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.14em] text-deck-dim">
            <span className="h-px w-8 bg-deck-signal" />
            <span className="text-deck-signal">/pages/nyctmc — deck/01</span>
          </div>
          <h1 className="mt-1 text-xl xl:text-2xl font-extrabold uppercase tracking-tight text-deck-fg">
            NYC TMC <span className="text-deck-signal">·</span> CAMERA
            INTELLIGENCE
          </h1>
          <p className="mt-1 max-w-[80ch] text-[11px] font-medium text-deck-dim">
            Live NYC traffic snapshots · on-demand Gemma 4 analysis over the
            local network.
          </p>
        </div>
        <div className="hidden flex-col items-end gap-1.5 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-deck-dim md:flex">
          <div className="flex items-center gap-2">
            <span className="deck-dot text-deck-signal deck-blink" />
            <span className="text-deck-signal">FEED LIVE</span>
          </div>
          <div className="deck-num tabular-nums text-deck-fg text-[13px]">
            {clock} UTC
          </div>
          <div className="deck-num tabular-nums">
            [{String(selectedIndex).padStart(3, "0")}/
            {String(cameras.length).padStart(3, "0")}]
          </div>
        </div>
      </div>

      {/* Main 3-column grid */}
      <div className="nyctmc-grid grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)_270px] xl:grid-cols-[250px_minmax(0,1fr)_300px]">
        {/* -------- LEFT: camera catalog -------- */}
        <aside className="deck-panel flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-deck-line px-3 py-3">
            <div className="deck-label-hi">CATALOG</div>
            <div className="deck-num text-[12px] font-bold text-deck-fg">
              {isLoading
                ? "..."
                : String(filteredCameras.length).padStart(3, "0")}
            </div>
          </div>
          <div className="shrink-0 border-b border-deck-line p-3">
            <input
              className="deck-input"
              aria-label="Search cameras"
              placeholder="Search location or borough"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div
            ref={catalogRef}
            className="nyctmc-catalog min-h-0 flex-1 overflow-y-auto"
          >
            {isLoading && (
              <div className="flex items-center gap-2 p-4 text-[12px] font-bold text-deck-dim">
                <span className="deck-dot text-deck-signal deck-blink" />
                acquiring catalog…
              </div>
            )}
            {error && (
              <div className="p-4 text-[12px] font-bold text-deck-alert">
                err: {error}
              </div>
            )}
            {!isLoading && !filteredCameras.length && (
              <div className="p-4 text-[12px] font-bold text-deck-dim">
                no match · "{search}"
              </div>
            )}
            <ul>
              {pagedCameras.map((camera, i) => {
                const isActive = selectedCamera?.id === camera.id;
                return (
                  <li key={camera.id}>
                    <button
                      type="button"
                      aria-pressed={isActive}
                      title={camera.name}
                      onClick={() => selectCamera(camera)}
                      className={`flex w-full items-start gap-2 border-b border-deck-line/50 px-3 py-2.5 text-left transition-colors hover:bg-deck-panel ${
                        isActive ? "bg-deck-elev" : ""
                      }`}
                    >
                      <span
                        className={`deck-num mt-0.5 w-8 text-[11px] font-bold tabular-nums ${
                          isActive ? "text-deck-signal" : "text-deck-faint"
                        }`}
                      >
                        {String(pageStart + i + 1).padStart(3, "0")}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span
                          className={`block truncate text-[13px] font-bold ${
                            isActive ? "text-deck-signal" : "text-deck-fg"
                          }`}
                        >
                          {camera.name}
                        </span>
                        <span className="deck-label mt-1 block">
                          {camera.area ?? "— unknown —"}
                        </span>
                      </span>
                      {isActive && (
                        <span className="deck-dot mt-1.5 text-deck-signal" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <nav
            aria-label="Camera pagination"
            className="shrink-0 border-t border-deck-line p-3"
          >
            <div className="mb-2 text-[10px] text-deck-dim" aria-live="polite">
              {filteredCameras.length ? pageStart + 1 : 0}–
              {Math.min(pageStart + PAGE_SIZE, filteredCameras.length)} of{" "}
              {filteredCameras.length} cameras
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="deck-btn nyctmc-page-button"
                aria-label="Previous camera page"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                ‹ Prev
              </button>
              <span className="text-[11px] tabular-nums">
                {currentPage} / {pageCount}
              </span>
              <button
                type="button"
                className="deck-btn nyctmc-page-button"
                aria-label="Next camera page"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next ›
              </button>
            </div>
          </nav>
        </aside>

        {/* -------- CENTER: main feed + controls -------- */}
        <section className="nyctmc-feed flex min-h-0 min-w-0 flex-col gap-3">
          {selectedCamera ? (
            <>
              {/* Feed header */}
              <div className="deck-panel shrink-0 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="deck-label-hi">ACTIVE FEED</div>
                    <div className="mt-1 truncate text-sm font-extrabold uppercase text-deck-fg">
                      {selectedCamera.name}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase text-deck-dim">
                      <span>◉ {selectedCamera.area ?? "unknown area"}</span>
                      {selectedCamera.latitude != null && (
                        <span className="deck-num">
                          {selectedCamera.latitude.toFixed(4)}°N{" "}
                          {Math.abs(selectedCamera.longitude ?? 0).toFixed(4)}°W
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImageSeed(Date.now())}
                    className="deck-btn deck-btn--ghost shrink-0"
                  >
                    ↻ REFRESH
                  </button>
                </div>
              </div>

              {/* Video container */}
              <div className="nyctmc-video deck-panel relative deck-scanlines overflow-hidden bg-black">
                <div className="absolute left-3 top-3 z-10 flex items-center gap-2 bg-deck-bg/80 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-deck-signal">
                  <span className="deck-dot deck-blink" />
                  LIVE · CAM {String(selectedIndex).padStart(3, "0")}
                </div>
                <div className="absolute right-3 top-3 z-10 deck-num text-[12px] font-bold text-deck-fg bg-deck-bg/80 px-2.5 py-1.5">
                  {clock}
                </div>
                <div className="absolute bottom-3 left-3 z-10 deck-label text-deck-signal bg-deck-bg/80 px-2.5 py-1.5">
                  SNAPSHOT
                </div>
                <div className="absolute bottom-3 right-3 z-10 deck-num text-[11px] font-bold text-deck-dim bg-deck-bg/80 px-2.5 py-1.5">
                  REFRESH · 5s
                </div>
                {currentImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={imageSeed}
                    src={currentImageUrl}
                    alt={selectedCamera.name}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-[12px] font-bold text-deck-dim">
                    no signal
                  </div>
                )}
              </div>

              {/* Transcript + analyze control */}
              <form
                className="nyctmc-controls deck-panel shrink-0 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAnalyze();
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label htmlFor="operator-notes" className="deck-label-hi">
                    OPERATOR NOTES
                  </label>
                  <span className="text-[10px] text-deck-dim">
                    Enter to analyze · Shift+Enter for a new line
                  </span>
                </div>
                <textarea
                  id="operator-notes"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void handleAnalyze();
                    }
                  }}
                  placeholder="› verbal context from dispatch or witness…"
                  className="deck-input block resize-none"
                  rows={2}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="submit"
                    disabled={isAnalyzing}
                    className="deck-btn deck-btn--primary"
                  >
                    {isAnalyzing ? "▸ INFERENCE RUNNING…" : "▸ ANALYZE FRAME"}
                  </button>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-deck-dim">
                    <span>MODEL · GEMMA-4-26B-A4B</span>
                    {lastAnalyzedAt && (
                      <span className="deck-num tabular-nums text-deck-fg">
                        LAST{" "}
                        {lastAnalyzedAt.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    )}
                  </div>
                </div>
                {analysisError && (
                  <div className="mt-3 border-l-2 border-deck-alert bg-deck-alert/10 px-3 py-2 text-[12px] font-bold text-deck-alert">
                    err · {analysisError}
                  </div>
                )}
              </form>
            </>
          ) : (
            <div className="deck-panel flex min-h-[200px] flex-1 items-center justify-center p-4">
              <div className="text-center">
                <div className="deck-label-hi mb-2">NO CAMERA SELECTED</div>
                <div className="text-[11px] text-deck-dim">
                  › pick a feed from the catalog to begin
                </div>
              </div>
            </div>
          )}
        </section>

        {/* -------- RIGHT: detection stream -------- */}
        <aside className="deck-panel flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-deck-line px-3 py-3">
            <div className="deck-label-hi">DETECTION STREAM</div>
            <div
              className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] ${
                hasDanger
                  ? "text-deck-alert"
                  : analysisResult
                    ? "text-deck-ok"
                    : "text-deck-dim"
              }`}
            >
              <span className="deck-dot" />
              {isAnalyzing
                ? "RUNNING"
                : hasDanger
                  ? "HAZARD"
                  : analysisResult
                    ? "DONE"
                    : "IDLE"}
            </div>
          </div>

          <div
            className="nyctmc-events min-h-0 flex-1 overflow-y-auto"
            aria-live="polite"
          >
            {!analysisResult && !isAnalyzing && (
              <div className="p-4 text-[12px] font-bold text-deck-dim">
                // stream idle — run analysis to populate
              </div>
            )}
            {isAnalyzing && (
              <div className="flex items-center gap-2 p-4 text-[12px] font-bold text-deck-signal">
                <span className="deck-dot deck-blink" />
                inference in progress…
              </div>
            )}
            {analysisResult?.events?.length === 0 && (
              <div className="p-4 text-[12px] font-bold text-deck-dim">
                // no events returned by model
              </div>
            )}
            <ul>
              {analysisResult?.events?.map((event, idx) => (
                <li
                  key={`${event.timestamp}-${idx}`}
                  className={`border-l-2 px-4 py-3 ${
                    event.isDangerous
                      ? "border-deck-alert bg-deck-alert/10"
                      : "border-deck-line"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em]">
                    <span
                      className={
                        event.isDangerous ? "text-deck-alert" : "text-deck-dim"
                      }
                    >
                      {event.isDangerous ? "▲ HAZARD" : "■ OBSERVATION"}
                    </span>
                    <span className="deck-num text-deck-faint">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="deck-num mt-2 text-[12px] font-bold tabular-nums text-deck-signal">
                    T{event.timestamp}
                  </div>
                  <div className="mt-1.5 text-[13px] font-medium leading-snug text-deck-fg">
                    {event.description}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Raw response preview */}
          {analysisResult?.rawResponse && (
            <details className="shrink-0 border-t border-deck-line bg-deck-bg/60 p-3">
              <summary className="deck-label cursor-pointer">
                RAW · JSON
              </summary>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] font-medium leading-tight text-deck-dim">
                {analysisResult.rawResponse}
              </pre>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}
