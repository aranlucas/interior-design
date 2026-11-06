import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Dialog } from "./studio-controls";
import { exportEditMask } from "../lib/edit-mask";
import { assetUrl } from "../lib/types";
import type { StudioState } from "../hooks/use-studio";
import type { Design } from "../lib/types";
const MAX = 1536;
export function DesignEditor({
  state,
  design,
  onClose,
}: {
  state: StudioState;
  design: Design;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [brush, setBrush] = useState(40);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<ImageBitmap | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const strokesRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(assetUrl(design.key));
      if (!response.ok) throw new Error("Could not load the design image.");
      const bitmap = await createImageBitmap(await response.blob());
      if (cancelled) {
        bitmap.close();
        return;
      }
      const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      imageRef.current = bitmap;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
      const mask = document.createElement("canvas");
      mask.width = width;
      mask.height = height;
      const ctx = mask.getContext("2d")!;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      maskRef.current = mask;
      setReady(true);
    })().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not load the design image."),
    );
    return () => {
      cancelled = true;
      imageRef.current?.close();
      imageRef.current = null;
    };
  }, [design.key]);
  function toCanvas(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return {
      x: (e.clientX - rect.left) * scale,
      y: (e.clientY - rect.top) * scale,
      radius: (brush / 2) * scale,
    };
  }
  function paint(x: number, y: number, radius: number, first: boolean) {
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    if (!canvas || !mask) return;
    const last = lastRef.current;
    const dot = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    const line = (ctx: CanvasRenderingContext2D) => {
      if (!last) return dot(ctx);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    };
    const mctx = mask.getContext("2d")!;
    mctx.globalCompositeOperation = "destination-out";
    mctx.fillStyle = mctx.strokeStyle = "#000";
    mctx.lineWidth = radius * 2;
    mctx.lineCap = mctx.lineJoin = "round";
    if (first) dot(mctx);
    else line(mctx);
    const dctx = canvas.getContext("2d")!;
    dctx.save();
    dctx.globalAlpha = 0.35;
    dctx.fillStyle = dctx.strokeStyle = "#ff5a5a";
    dctx.lineWidth = radius * 2;
    dctx.lineCap = dctx.lineJoin = "round";
    if (first) dot(dctx);
    else line(dctx);
    dctx.restore();
    lastRef.current = { x, y };
    strokesRef.current++;
  }
  function onDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!ready || busy) return;
    setError("");
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastRef.current = null;
    const { x, y, radius } = toCanvas(e);
    paint(x, y, radius, true);
  }
  function onMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const { x, y, radius } = toCanvas(e);
    paint(x, y, radius, false);
  }
  function onUp() {
    drawingRef.current = false;
    lastRef.current = null;
  }
  function reset() {
    const bitmap = imageRef.current;
    const mask = maskRef.current;
    const canvas = canvasRef.current;
    if (!bitmap || !mask || !canvas) return;
    const mctx = mask.getContext("2d")!;
    mctx.globalCompositeOperation = "source-over";
    mctx.fillStyle = "#000";
    mctx.fillRect(0, 0, mask.width, mask.height);
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    strokesRef.current = 0;
    lastRef.current = null;
  }
  async function submit() {
    const mask = maskRef.current;
    if (!mask) return;
    if (!strokesRef.current) {
      setError("Brush over the area you want to change.");
      return;
    }
    if (!instruction.trim()) {
      setError("Describe the change for the brushed area.");
      return;
    }
    setBusy(true);
    try {
      const bitmap = imageRef.current;
      if (!bitmap) throw new Error("Could not load the design image.");
      const maskBlob = await exportEditMask(mask, bitmap);
      const ok = await state.submitEdit(design, instruction.trim(), maskBlob);
      if (ok) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The edit failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Brush edit" busy={busy} onClose={onClose}>
      <p className="muted small">
        Brush the area to change, describe what should replace it, and a new design is generated.
        The rest of the image is preserved.
      </p>
      <div className="editor-canvas">
        <canvas
          ref={canvasRef}
          style={{ touchAction: "none", cursor: ready && !busy ? "crosshair" : "default" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label="Design brush editor"
        />
        {!ready && <LoaderCircle className="spin" size={22} aria-label="Loading design" />}
      </div>
      <label className="field">
        <span>
          Brush size <em>{brush} px</em>
        </span>
        <input
          type="range"
          min={10}
          max={120}
          value={brush}
          disabled={busy}
          onChange={(e) => setBrush(Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span>Change</span>
        <textarea
          rows={3}
          maxLength={1000}
          value={instruction}
          disabled={busy}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Replace the rug with a jute one. Fix the warped cabinet door."
        />
      </label>
      <div className="field-row">
        <button className="button" type="button" disabled={busy || !ready} onClick={reset}>
          Reset
        </button>
        <button
          className="button primary block"
          disabled={busy || !ready}
          onClick={() => void submit()}
        >
          {busy ? (
            <>
              <LoaderCircle size={16} className="spin" /> Editing…
            </>
          ) : (
            "Generate edit"
          )}
        </button>
      </div>
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
