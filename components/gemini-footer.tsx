/**
 * Local-model footer. File name kept as `gemini-footer.tsx` and the
 * exported symbol kept as `GeminiFooter` so existing imports continue to
 * work, but the rendered label now reflects the actual backend: a local
 * Gemma 4 model served by LM Studio.
 */
export function GeminiFooter() {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Powered by</span>
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_theme(colors.emerald.500)]"
      />
      <span className="text-xs font-medium">Gemma 4 · LM Studio (local)</span>
    </div>
  );
}
