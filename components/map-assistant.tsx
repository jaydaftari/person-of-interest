"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { Camera, PatrolRoute, RiskScore } from "@/types";
import { RouteDetails } from "./route-details";
import {
  TrafficComparisonCard,
  type TrafficComparison,
} from "./traffic-comparison";

interface CameraResult {
  id: string;
  name: string;
  risk?: RiskScore | null;
  analysisStatus?: string;
}
interface ToolResult {
  cameras?: CameraResult[];
  camera?: Camera;
  risk?: RiskScore | null;
  cameraId?: string;
  cameraName?: string;
  events?: { description: string; timestamp: string; isDangerous: boolean }[];
  analyzedAt?: string;
  source?: string;
  interpretation?: string;
  route?: PatrolRoute;
  error?: string;
  comparison?: TrafficComparison;
  routeComparison?: {
    description: string;
    interpretation: string;
    rankedRoutes: {
      routeId: string;
      value: number;
      coveredStopCells: number;
      totalStops: number;
    }[];
    tiedBestRouteIds: string[];
  };
}
interface ToolRun {
  name: string;
  result?: ToolResult;
  error?: boolean;
  elapsedMs?: number;
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tools?: ToolRun[];
  answerId?: string;
  answerStatus?: string;
  evidence?: {
    id: string;
    why: string;
    tool: string;
    retrievedAt: string;
    sources: { label: string; url: string }[];
    record: Record<string, unknown>;
  }[];
}
interface Props {
  selectedCameraId?: string | null;
  selectedCameraName?: string;
  onMonitorCamera?: (id: string, name: string) => void;
  monitoringBusy?: boolean;
  onCameraClick: (id: string) => void;
  onCamerasFound: (ids: string[]) => void;
  onRoute: (route: PatrolRoute) => void;
  onMonitoringChange?: () => void;
  onSelectRoute?: (id: string) => void;
  compact?: boolean;
}

export function MapAssistant({
  selectedCameraId,
  selectedCameraName,
  onMonitorCamera,
  monitoringBusy,
  onCameraClick,
  onCamerasFound,
  onRoute,
  onMonitoringChange,
  onSelectRoute,
  compact,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Ask about a location or select a camera.",
  );
  const [connected, setConnected] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const visibleIds = useRef<string[]>([]);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, status]);

  const submit = async (prompt = input) => {
    if (!prompt.trim() || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const history: ChatMessage[] = [
      ...messages,
      { role: "user", content: prompt.trim() },
    ];
    setMessages([...history, { role: "assistant", content: "", tools: [] }]);
    setInput("");
    setBusy(true);
    setStatus("Connecting…");
    const update = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) =>
        prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)),
      );
    try {
      const response = await fetch("/api/operations/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          messages: history
            .filter((m) => m.content)
            .slice(-10)
            .map(({ role, content }) => ({ role, content })),
          selectedCameraId,
          visibleCameraIds: visibleIds.current,
        }),
      });
      if (!response.ok || !response.body)
        throw new Error(
          "Assistant unavailable. Check the backend and try again.",
        );
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const receive = (line: string) => {
        if (!line.trim()) return;
        const e = JSON.parse(line);
        if (e.type === "status") setStatus(e.message);
        if (e.type === "connected") {
          setConnected(true);
          setStatus("Planning tool calls…");
        }
        if (e.type === "tool_start") {
          setStatus(`${e.name.replaceAll("_", " ")}…`);
          update((m) => ({
            ...m,
            tools: [...(m.tools ?? []), { name: e.name }],
          }));
        }
        if (e.type === "tool_result") {
          const result: ToolResult = e.result;
          update((m) => {
            const tools = [...(m.tools ?? [])];
            const idx = tools.findIndex((t) => t.name === e.name && !t.result);
            const run = {
              name: e.name,
              result,
              error: e.error,
              elapsedMs: e.elapsedMs,
            };
            if (idx >= 0) tools[idx] = run;
            else tools.push(run);
            return { ...m, tools };
          });
          if (!e.error && result.cameras) {
            visibleIds.current = result.cameras.map((c) => c.id);
            onCamerasFound(visibleIds.current);
          }
          if (result.route) onRoute(result.route);
          if (
            [
              "start_monitoring",
              "stop_monitoring",
              "get_monitoring_status",
              "acknowledge_monitoring_alert",
            ].includes(e.name)
          )
            onMonitoringChange?.();
          setStatus("Summarizing results…");
        }
        if (e.type === "answer")
          update((m) => ({
            ...m,
            content: e.content,
            answerId: e.answerId,
            answerStatus: e.answerStatus,
            evidence: e.evidence,
          }));
        if (e.type === "error") throw new Error(e.message);
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(receive);
        if (done) {
          if (buffer.trim()) receive(buffer);
          break;
        }
      }
      setStatus("Ready");
    } catch (err) {
      const text = abort.signal.aborted
        ? "Stopped. Completed results remain available."
        : (err as Error).message;
      update((m) => ({ ...m, content: m.content || text }));
      setStatus(text);
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };

  return (
    <section
      className={`flex min-h-0 flex-1 flex-col ${compact ? "" : "h-full"}`}
    >
      <div className="shrink-0 border-b border-white/10 px-3 py-2 text-[10px] text-white/60">
        <span className={connected ? "text-emerald-300" : "text-white/50"}>
          {connected ? "● MCP connected" : "Local model · MCP tools"}
        </span>
        <p className="mt-1 break-words">
          {selectedCameraId
            ? `Selected: ${selectedCameraName ?? selectedCameraId}`
            : "No camera selected — search a location, then click Monitor beside a result."}
        </p>
      </div>
      <div
        ref={scroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="space-y-2 text-xs">
            <p className="mb-3 text-white/60">
              Find cameras, inspect a frame, or plan a driving route.
            </p>
            {[
              "Find 3 cameras near Times Square",
              "Which route has more recorded collisions?",
              "Compare traffic on three Manhattan streets",
            ].map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() => void submit(p)}
                className="block w-full rounded border border-white/15 bg-white/5 p-2 text-left text-white/80 hover:border-amber-400"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {messages.map((message, i) => (
          <div
            key={i}
            className={`space-y-2 rounded border p-2.5 text-xs leading-relaxed ${message.role === "user" ? "border-amber-400/30 bg-amber-400/10" : "border-white/10 bg-black/30"}`}
          >
            <div className="text-[9px] uppercase tracking-wider text-white/40">
              {message.role === "user" ? "You" : "Assistant"}
            </div>
            {message.tools?.map((tool, j) => (
              <div
                key={j}
                className="space-y-2 border-l border-cyan-400/40 pl-2"
              >
                <div
                  className={`text-[10px] ${tool.error ? "text-amber-300" : "text-cyan-300"}`}
                >
                  {tool.result ? (tool.error ? "!" : "✓") : "…"}{" "}
                  {tool.name.replaceAll("_", " ")}
                  {tool.elapsedMs != null
                    ? ` · ${(tool.elapsedMs / 1000).toFixed(1)}s`
                    : ""}
                </div>
                {tool.result?.error && (
                  <p className="text-amber-300">{tool.result.error}</p>
                )}
                {tool.result?.cameras?.map((camera) => (
                  <div
                    key={camera.id}
                    className="rounded border border-white/10 p-2"
                  >
                    <button
                      type="button"
                      onClick={() => onCameraClick(camera.id)}
                      className="block w-full text-left text-cyan-100 underline underline-offset-2"
                    >
                      {camera.name}
                    </button>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="select-text text-[9px] text-white/50">
                        ID: {camera.id}
                        <br />
                        {camera.analysisStatus ?? "not analyzed"}
                      </span>
                      {onMonitorCamera && (
                        <button
                          type="button"
                          disabled={monitoringBusy}
                          onClick={() =>
                            onMonitorCamera(camera.id, camera.name)
                          }
                          className="rounded border border-emerald-400/40 px-2 py-1 text-[10px] text-emerald-200 disabled:opacity-40"
                        >
                          Monitor
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {tool.result?.camera && (
                  <button
                    type="button"
                    onClick={() => onCameraClick(tool.result!.camera!.id)}
                    className="text-cyan-100 underline"
                  >
                    {tool.result.camera.name}
                  </button>
                )}
                {tool.result?.risk?.reasons && (
                  <p className="text-white/60">
                    {tool.result.risk.reasons.join(" · ")}
                  </p>
                )}
                {tool.result?.events?.map((ev, k) => (
                  <p key={k} className="text-white/80">
                    {ev.description}
                  </p>
                ))}
                {tool.result?.analyzedAt && (
                  <p className="text-[10px] text-white/40">
                    Observed{" "}
                    {new Date(tool.result.analyzedAt).toLocaleTimeString()} ·
                    model interpretation
                  </p>
                )}
                {tool.result?.route && (
                  <RouteDetails
                    route={tool.result.route}
                    onCameraClick={onCameraClick}
                  />
                )}
                {tool.result?.routeComparison && (
                  <div className="space-y-2">
                    <p className="text-amber-200">
                      {tool.result.routeComparison.description}
                    </p>
                    {tool.result.routeComparison.rankedRoutes.map((route) => (
                      <button
                        key={route.routeId}
                        onClick={() => onSelectRoute?.(route.routeId)}
                        className="flex w-full items-center justify-between rounded border border-white/15 p-2 text-left text-cyan-200"
                      >
                        <span>{route.routeId}</span>
                        <span>{Math.round(route.value * 100) / 100}</span>
                      </button>
                    ))}
                    {tool.result.routeComparison.tiedBestRouteIds.length >
                      1 && (
                      <p className="text-white/60">
                        Tied:{" "}
                        {tool.result.routeComparison.tiedBestRouteIds.join(
                          ", ",
                        )}
                      </p>
                    )}
                    <p className="text-[10px] text-white/50">
                      {tool.result.routeComparison.interpretation}
                    </p>
                  </div>
                )}
                {tool.result?.comparison && (
                  <TrafficComparisonCard
                    comparison={tool.result.comparison}
                    onCameraClick={onCameraClick}
                  />
                )}
                {tool.result?.source && (
                  <p className="text-[9px] text-white/40 break-words">
                    Source: {tool.result.source}
                  </p>
                )}
              </div>
            ))}
            {message.content && message.role === "assistant" ? (
              <div className="min-w-0 space-y-2 break-words [&_strong]:font-semibold [&_strong]:text-white [&_em]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li>p]:my-1 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-white/30 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/40 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_hr]:border-white/15">
                <Markdown
                  skipHtml
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target={href?.startsWith("#") ? undefined : "_blank"}
                        rel="noopener noreferrer"
                        className="text-cyan-200 underline underline-offset-2"
                      >
                        {children}
                      </a>
                    ),
                    img: ({ alt }) => <span>{alt}</span>,
                  }}
                >
                  {message.content}
                </Markdown>
              </div>
            ) : message.content ? (
              <p className="whitespace-pre-wrap break-words">
                {message.content}
              </p>
            ) : null}
            {!!message.evidence?.length && (
              <section
                className="space-y-2 border-t border-white/15 pt-2"
                aria-label="Evidence and sources"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                  Evidence &amp; sources
                  {message.answerStatus === "partial"
                    ? " · Limited answer"
                    : message.answerStatus === "unsupported"
                      ? " · Cannot verify"
                      : ""}
                </p>
                {message.evidence.map((evidence) => (
                  <div
                    id={`evidence-${message.answerId}-${evidence.id}`}
                    key={evidence.id}
                    className="scroll-mt-3 space-y-1 rounded border border-white/10 p-2 target:border-amber-400"
                  >
                    <p className="text-[10px] text-cyan-200">
                      {evidence.id} · {evidence.tool.replaceAll("_", " ")}
                    </p>
                    <p className="text-[10px] text-white/70">
                      <strong>Why:</strong> {evidence.why}
                    </p>
                    <p className="text-[9px] text-white/40">
                      Retrieved{" "}
                      {new Date(evidence.retrievedAt).toLocaleString()}
                    </p>
                    {evidence.sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-[10px] text-cyan-200 underline underline-offset-2"
                      >
                        {source.label}
                      </a>
                    ))}
                    <details className="text-[10px] text-white/50">
                      <summary className="cursor-pointer">
                        View supporting record
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[9px]">
                        {JSON.stringify(evidence.record, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </section>
            )}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="shrink-0 border-t border-white/10 p-3"
      >
        <label htmlFor="map-assistant-prompt" className="sr-only">
          Ask the map assistant
        </label>
        <textarea
          id="map-assistant-prompt"
          rows={2}
          maxLength={4000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Find cameras, monitor a zone, or compare routes…"
          className="w-full resize-none rounded border border-white/20 bg-black/50 p-2 text-xs outline-none focus:border-amber-400"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span
            className="min-w-0 truncate text-[9px] text-white/40"
            title={status}
          >
            {status}
          </span>
          {busy ? (
            <button
              type="button"
              onClick={() => controller.current?.abort()}
              className="shrink-0 border border-white/20 px-3 py-1 text-xs"
            >
              Stop reply
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="shrink-0 bg-amber-400 px-3 py-1 text-xs font-bold text-black disabled:opacity-40"
            >
              Send ↵
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
