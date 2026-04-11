"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Camera, CheckCircle2, Loader2, MapPin, RefreshCcw } from "lucide-react"
import type { NyctmcCamera } from "@/lib/nyctmc"
import type { FrameEvent } from "@/lib/lmstudio"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface AnalyzeResponse {
  events: FrameEvent[]
  rawResponse?: string
}

const CAMERA_LIMIT = 200
const IMAGE_REFRESH_MS = 5000

export default function NyctmcPage() {
  const [cameras, setCameras] = useState<NyctmcCamera[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [selectedCamera, setSelectedCamera] = useState<NyctmcCamera | null>(null)
  const [imageSeed, setImageSeed] = useState(Date.now())
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalyzeResponse | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<Date | null>(null)
  const [transcript, setTranscript] = useState("")

  useEffect(() => {
    const loadCameras = async () => {
      try {
        setIsLoading(true)
        const response = await fetch(`/api/nyctmc/cameras?limit=${CAMERA_LIMIT}`)
        if (!response.ok) {
          throw new Error("Failed to load NYCTMC cameras")
        }
        const data = await response.json()
        setCameras(data.cameras ?? [])
        if (!selectedCamera && data.cameras?.length) {
          setSelectedCamera(data.cameras[0])
        }
      } catch (err) {
        console.error(err)
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setIsLoading(false)
      }
    }

    loadCameras()
    // We only want to run this once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedCamera) return

    const interval = setInterval(() => {
      setImageSeed(Date.now())
    }, IMAGE_REFRESH_MS)

    return () => clearInterval(interval)
  }, [selectedCamera])

  const filteredCameras = useMemo(() => {
    if (!search.trim()) return cameras
    const query = search.toLowerCase()
    return cameras.filter((camera) =>
      [camera.name, camera.area]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    )
  }, [cameras, search])

  const currentImageUrl = selectedCamera ? `${selectedCamera.imageUrl}?t=${imageSeed}` : null

  const handleAnalyze = async () => {
    if (!selectedCamera) return

    setIsAnalyzing(true)
    setAnalysisError(null)

    try {
      const response = await fetch("/api/nyctmc/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraId: selectedCamera.id, transcript: transcript.trim() || undefined }),
      })

      if (!response.ok) {
        throw new Error("Model analysis failed")
      }

      const data: AnalyzeResponse = await response.json()
      setAnalysisResult(data)
      setLastAnalyzedAt(new Date())
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed")
    } finally {
      setIsAnalyzing(false)
    }
  }

  const hasDanger = analysisResult?.events?.some((event) => event.isDangerous)

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-wide text-purple-300">Live NYC DOT Feeds</p>
          <h1 className="text-4xl font-bold">NYCTMC Camera Intelligence</h1>
          <p className="text-white/70">
            Pull live stills straight from the New York City Traffic Management Center feed catalog and route them
            through the on-device LM Studio model for quick situational awareness.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-2xl bg-white/5 p-4 backdrop-blur">
            <div className="flex items-center gap-2 text-sm text-white/70">
              <Camera className="h-4 w-4" />
              <span>{isLoading ? "Loading cameras…" : `${filteredCameras.length} cameras online`}</span>
            </div>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search locations or boroughs"
              className="mt-3 bg-white/10 text-white placeholder:text-white/40"
            />
            <div className="mt-4 flex h-[60vh] flex-col gap-3 overflow-y-auto pr-2">
              {isLoading && <p className="text-sm text-white/60">Fetching live catalog…</p>}
              {error && <p className="text-sm text-red-400">{error}</p>}
              {!isLoading && !filteredCameras.length && (
                <p className="text-sm text-white/60">No cameras match "{search}"</p>
              )}
              {filteredCameras.map((camera) => (
                <button
                  key={camera.id}
                  type="button"
                  onClick={() => {
                    setSelectedCamera(camera)
                    setAnalysisResult(null)
                  }}
                  className={`rounded-xl border border-white/10 p-3 text-left transition hover:border-white/40 ${
                    selectedCamera?.id === camera.id ? "bg-white/15" : "bg-white/5"
                  }`}
                >
                  <p className="font-medium">{camera.name}</p>
                  <p className="text-xs text-white/60">{camera.area ?? "Unknown area"}</p>
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-6">
            {selectedCamera ? (
              <div className="space-y-4 rounded-2xl bg-white/5 p-4 backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold">{selectedCamera.name}</h2>
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <MapPin className="h-4 w-4" />
                      <span>{selectedCamera.area ?? "Unknown borough"}</span>
                    </div>
                  </div>
                  <Button variant="secondary" onClick={() => setImageSeed(Date.now())} className="gap-2">
                    <RefreshCcw className="h-4 w-4" />
                    Refresh frame
                  </Button>
                </div>

                {currentImageUrl ? (
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
                    <img
                      key={imageSeed}
                      src={currentImageUrl}
                      alt={selectedCamera.name}
                      className="w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-white/60">No preview available.</p>
                )}

                <div className="space-y-3">
                  <label className="text-sm font-medium text-white/80" htmlFor="transcript">
                    Optional transcript or operator notes
                  </label>
                  <textarea
                    id="transcript"
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                    placeholder="Add verbal context from dispatch or witnesses"
                    className="w-full rounded-xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                    rows={3}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Button onClick={handleAnalyze} disabled={isAnalyzing} className="gap-2">
                    {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {isAnalyzing ? "Running inference…" : "Analyze latest frame"}
                  </Button>
                  {lastAnalyzedAt && (
                    <p className="text-xs text-white/60">
                      Last analyzed {lastAnalyzedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </p>
                  )}
                </div>

                {analysisError && <p className="text-sm text-red-400">{analysisError}</p>}

                {analysisResult && (
                  <div className={`rounded-xl border p-4 ${hasDanger ? "border-red-400/50 bg-red-500/10" : "border-green-400/30 bg-green-500/5"}`}>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {hasDanger ? (
                        <>
                          <AlertTriangle className="h-4 w-4 text-red-300" />
                          <span className="text-red-200">Potential hazards detected</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-green-300" />
                          <span className="text-green-200">No dangerous activity spotted</span>
                        </>
                      )}
                    </div>
                    <ul className="mt-4 space-y-3">
                      {analysisResult.events?.map((event, index) => (
                        <li
                          key={`${event.timestamp}-${index}`}
                          className={`rounded-lg border p-3 text-sm ${
                            event.isDangerous
                              ? "border-red-400/40 bg-red-500/10 text-red-50"
                              : "border-white/10 bg-white/5 text-white"
                          }`}
                        >
                          <p className="text-xs uppercase tracking-wide text-white/60">{event.timestamp}</p>
                          <p className="font-medium">{event.description}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/20 p-10 text-center text-white/60">
                Select a camera to get started.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
