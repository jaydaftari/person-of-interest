"use client";

import { useState } from "react";
import { CameraFeed } from "@/components/camera-feed";
import { CameraModal } from "@/components/camera-modal";
import { EventFeed } from "@/components/event-feed";
import { StatsOverview } from "@/components/stats-overview";
import { locations, events } from "@/lib/data";

// DECK/01 dashboard — tactical grid view of all registered cameras.
// No auth gate in the local demo build.
export default function ProtectedPage() {
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [videoTimes, setVideoTimes] = useState<Record<string, number>>({});
  const [hoveredCamera, setHoveredCamera] = useState<string | null>(null);

  const handleTimeUpdate = (cameraId: string, time: number) => {
    setVideoTimes((prev) => ({ ...prev, [cameraId]: time }));
  };

  const handleEventClick = (cameraId: string, timestamp: number) => {
    setSelectedCamera(cameraId);
    setVideoTimes((prev) => ({ ...prev, [cameraId]: timestamp }));
  };

  const allCameras = locations.flatMap((l) => l.cameras);

  return (
    <div className="relative mx-auto max-w-[1600px] px-6 py-8">
      {/* Page header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-deck-dim">
            <span className="h-px w-8 bg-deck-signal" />
            <span className="text-deck-signal">/protected — deck/00</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold uppercase tracking-tight text-deck-fg">
            GRID <span className="text-deck-signal">·</span> REGISTERED NODES
          </h1>
          <p className="mt-2 max-w-[60ch] text-xs text-deck-dim">
            Live tactical overview of every camera in the grid. Click a tile
            to drill down, hover to isolate.
          </p>
        </div>
        <div className="hidden md:flex items-center gap-6">
          <div className="text-right">
            <div className="deck-label">TOTAL NODES</div>
            <div className="mt-1 deck-num text-2xl text-deck-fg">
              {String(allCameras.length).padStart(3, "0")}
            </div>
          </div>
          <div className="text-right">
            <div className="deck-label">OPEN INCIDENTS</div>
            <div className="mt-1 deck-num text-2xl text-deck-signal">
              {String(events.length).padStart(3, "0")}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Camera grid */}
        <section>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {locations.flatMap((location) =>
              location.cameras.map((camera) => {
                const dimmed = hoveredCamera && hoveredCamera !== camera.id;
                return (
                  <button
                    key={camera.id}
                    onClick={() => setSelectedCamera(camera.id)}
                    onMouseEnter={() => setHoveredCamera(camera.id)}
                    onMouseLeave={() => setHoveredCamera(null)}
                    className={`deck-panel group relative block overflow-hidden text-left transition-opacity ${
                      dimmed ? "opacity-30" : "opacity-100"
                    }`}
                  >
                    <div className="relative aspect-video deck-scanlines">
                      <CameraFeed
                        camera={camera}
                        onTimeUpdate={(t) => handleTimeUpdate(camera.id, t)}
                      />
                      <div className="absolute left-2 top-2 z-10 flex items-center gap-2 bg-deck-bg/70 px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-deck-signal">
                        <span className="deck-dot deck-blink" />
                        LIVE
                      </div>
                      <div className="absolute right-2 top-2 z-10 deck-num text-[9px] text-deck-dim bg-deck-bg/70 px-2 py-1">
                        {camera.id}
                      </div>
                    </div>
                    <div className="border-t border-deck-line bg-deck-bg/60 px-3 py-2">
                      <div className="truncate text-[12px] uppercase text-deck-fg group-hover:text-deck-signal">
                        {camera.name}
                      </div>
                      <div className="deck-label mt-1 truncate">
                        ◉ {camera.address}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Sidebar */}
        <aside className="space-y-6">
          <div className="deck-panel p-4">
            <div className="deck-label-hi mb-3">OVERVIEW</div>
            <StatsOverview />
          </div>

          <div className="deck-panel flex flex-col overflow-hidden">
            <div className="border-b border-deck-line px-4 py-3">
              <div className="deck-label-hi">EVENT LOG</div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              <EventFeed
                events={events}
                videoTimes={videoTimes}
                onEventHover={setHoveredCamera}
                onEventClick={handleEventClick}
              />
            </div>
          </div>
        </aside>
      </div>

      {selectedCamera && (
        <CameraModal
          open={true}
          onOpenChange={(open) => !open && setSelectedCamera(null)}
          cameraId={selectedCamera}
          currentTime={videoTimes[selectedCamera]}
          date={new Date()}
        />
      )}
    </div>
  );
}
