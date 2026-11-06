import { useEffect, useRef, useState } from "react";
import { Clapperboard, LoaderCircle } from "lucide-react";
import { Dialog } from "./studio-controls";
import { assetUrl } from "../lib/types";
import type { Design } from "../lib/types";
const SECONDS = 5;
const MAX = 1536;
const TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
const smooth = (t: number) => t * t * (3 - 2 * t);
export function CompareVideo({
  design,
  beforeKey,
  roomName,
  onClose,
}: {
  design: Design;
  beforeKey: string;
  roomName: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<{ before: HTMLImageElement; after: HTMLImageElement } | null>(null);
  const rafRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const supported = typeof MediaRecorder !== "undefined";
  function drawFrame(phase: number) {
    const canvas = canvasRef.current;
    const images = imagesRef.current;
    if (!canvas || !images) return;
    const ctx = canvas.getContext("2d")!;
    const alpha =
      phase < 0.4 ? smooth(phase / 0.4) : phase < 0.6 ? 1 : smooth(Math.max(0, (1 - phase) / 0.4));
    ctx.drawImage(images.before, 0, 0, canvas.width, canvas.height);
    if (alpha > 0) {
      const scale = Math.min(
        canvas.width / images.after.naturalWidth,
        canvas.height / images.after.naturalHeight,
      );
      const width = images.after.naturalWidth * scale;
      const height = images.after.naturalHeight * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        images.after,
        (canvas.width - width) / 2,
        (canvas.height - height) / 2,
        width,
        height,
      );
      ctx.globalAlpha = 1;
    }
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const load = (key: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("Could not load the design images."));
          img.src = assetUrl(key);
        });
      const [before, after] = await Promise.all([load(beforeKey), load(design.key)]);
      if (cancelled) return;
      imagesRef.current = { before, after };
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, MAX / Math.max(before.naturalWidth, before.naturalHeight));
      canvas.width = Math.round(before.naturalWidth * scale);
      canvas.height = Math.round(before.naturalHeight * scale);
      setReady(true);
    })().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not load the design images."),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [beforeKey, design.key]);
  useEffect(() => {
    if (!ready || busy) return;
    const start = performance.now();
    const draw = (t: number) => {
      drawFrame(((t - start) / (SECONDS * 1000)) % 1);
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, busy]);
  async function exportVideo() {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    const mime = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) {
      setError("This browser can’t record video. Try Chrome or Firefox.");
      return;
    }
    setBusy(true);
    try {
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime.split(";")[0] }));
      });
      recorder.start();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const draw = (t: number) => {
          const phase = Math.min(1, (t - start) / (SECONDS * 1000));
          drawFrame(phase);
          if (phase < 1) rafRef.current = requestAnimationFrame(draw);
          else resolve();
        };
        rafRef.current = requestAnimationFrame(draw);
      });
      recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      const blob = await stopped;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${roomName}-before-after.${mime.startsWith("video/mp4") ? "mp4" : "webm"}`;
      a.click();
      // Delay the revoke so the download starts in Safari and Firefox.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the video.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Before/after video" busy={busy} onClose={onClose}>
      <p className="muted small">
        A {SECONDS}-second crossfade from before to after and back, recorded right in the browser.
      </p>
      <div className="editor-canvas">
        <canvas ref={canvasRef} aria-label="Before and after preview" />
        {!ready && <LoaderCircle className="spin" size={22} aria-label="Loading designs" />}
      </div>
      <button
        className="button primary block"
        disabled={busy || !ready || !supported}
        onClick={() => void exportVideo()}
      >
        {busy ? (
          <>
            <LoaderCircle size={16} className="spin" /> Recording…
          </>
        ) : (
          <>
            <Clapperboard size={16} /> Export video
          </>
        )}
      </button>
      {!supported && <p className="hint">Video recording isn’t supported in this browser.</p>}
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
