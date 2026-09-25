"use client";
import { useEffect, useState } from "react";
import type { Camera } from "@/types";
export function useOperationsCameras() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/operations/cameras", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Camera backend unavailable");
        const data = await response.json();
        if (!stopped) {
          setCameras(data);
          setError(null);
        }
      } catch (e) {
        if (!stopped) setError(e as Error);
      } finally {
        if (!stopped) timer = setTimeout(load, 10000);
      }
    }
    void load();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return {
    cameras,
    error,
    source: cameras.length ? "poi-brain" : "unavailable",
  };
}
