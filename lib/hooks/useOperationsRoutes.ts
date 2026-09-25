"use client";
import { useEffect, useState } from "react";
import type { PatrolRoute } from "@/types";
export function useOperationsRoutes() {
  const [routes, setRoutes] = useState<PatrolRoute[]>([]);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/operations/routes", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Road routes unavailable");
        const data = await response.json();
        if (!stopped) {
          setRoutes(data);
          setError(null);
        }
      } catch (e) {
        if (!stopped) setError(e as Error);
      } finally {
        if (!stopped) timer = setTimeout(load, 60000);
      }
    }
    void load();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return { routes, error };
}
