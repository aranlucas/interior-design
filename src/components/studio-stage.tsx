import { useEffect, useState } from "react";
import {
  Brush,
  Clapperboard,
  Download,
  ImagePlus,
  LoaderCircle,
  MoveHorizontal,
  Sparkles,
  Star,
} from "lucide-react";
import { assetUrl } from "../lib/types";
import { stepPhoto } from "../lib/photo-nav";
import { Filmstrips } from "./filmstrips";
import { DesignEditor } from "./design-editor";
import { CompareVideo } from "./compare-video";
import type { StudioState } from "../hooks/use-studio";
import { lazy, Suspense } from "react";
const RoomPreview = lazy(() => import("./room-preview"));
/** Fetch the stored prompt only when opened; it is too large to keep in room data. */
function DesignPrompt({ promptKey }: { promptKey: string }) {
  const [text, setText] = useState<string>();
  const [failed, setFailed] = useState(false);
  return (
    <details
      onToggle={(e) => {
        if (!e.currentTarget.open || text !== undefined) return;
        fetch(assetUrl(promptKey))
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
          .then(setText, () => setFailed(true));
      }}
    >
      <summary>Prompt sent to the image model</summary>
      <pre className="design-prompt">
        {failed ? "The saved prompt could not be loaded." : (text ?? "Loading…")}
      </pre>
    </details>
  );
}
export function StudioStage({ state }: { state: StudioState }) {
  const {
    generating,
    setView,
    split,
    setSplit,
    dragging,
    setDragging,
    input,
    photos,
    base,
    design,
    shown,
    active,
    before,
    locked,
    count,
    toggleStarred,
    drop,
    modal,
    sizeAsset,
    setBaseId,
    setDesignId,
  } = state;
  const room = state.room!;
  const [editing, setEditing] = useState(false);
  const [video, setVideo] = useState(false);
  const comparisonKey = design?.guide?.key || before?.key;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shown === "room") return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (editing || video || modal || sizeAsset || locked) return;
      const el = e.target;
      if (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      const next = stepPhoto(photos, base?.id || "", e.key === "ArrowRight" ? 1 : -1);
      if (!next) return;
      e.preventDefault();
      setBaseId(next.id);
      setDesignId("");
      setView("photo");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    photos,
    base,
    modal,
    sizeAsset,
    locked,
    shown,
    editing,
    video,
    setBaseId,
    setDesignId,
    setView,
  ]);
  return (
    <section className="stage">
      <div className="stage-bar">
        {photos.length > 0 || room.designs.length > 0 ? (
          <div className="segmented" role="group" aria-label="View">
            {(["photo", "room", ...(design ? (["design", "compare"] as const) : [])] as const).map(
              (v) => (
                <button
                  key={v}
                  aria-pressed={shown === v}
                  disabled={v === "compare" && !comparisonKey}
                  onClick={() => setView(v)}
                >
                  {v === "photo"
                    ? "Photo"
                    : v === "room"
                      ? "3D room"
                      : v === "design"
                        ? "Design"
                        : "Compare"}
                </button>
              ),
            )}
          </div>
        ) : (
          <span className="muted small">
            {photos.length
              ? `${photos.length} photo${photos.length > 1 ? "s" : ""}`
              : "No photos yet"}
          </span>
        )}
        {active && (
          <span className="stage-actions">
            <button
              className="icon-button"
              aria-label="Brush edit this design"
              title="Brush edit"
              disabled={locked}
              onClick={() => setEditing(true)}
            >
              <Brush size={16} />
            </button>
            {active.mode !== "final" && active.generation?.quality !== "max" && (
              <button
                className="icon-button"
                aria-label="Render final at maximum detail"
                title="Render final · max quality, same design"
                disabled={locked || !state.session?.generationConfigured}
                onClick={() => void state.renderFinal(active)}
              >
                <Sparkles size={16} />
              </button>
            )}
            {comparisonKey && (
              <button
                className="icon-button"
                aria-label="Export before/after video"
                title="Before/after video"
                disabled={locked}
                onClick={() => setVideo(true)}
              >
                <Clapperboard size={16} />
              </button>
            )}
            <button
              className="icon-button"
              aria-pressed={!!active.starred}
              aria-label={active.starred ? `Unsave ${active.mode || "this"} design` : "Save design"}
              title={active.starred ? "Unsave design" : "Save design"}
              disabled={locked}
              onClick={() => void toggleStarred(active.id)}
            >
              <Star size={16} className={active.starred ? "star-on" : undefined} />
            </button>
            <a
              className="icon-button"
              href={assetUrl(active.key)}
              download={`${room.name}-roomform.png`}
              aria-label="Download design"
              title="Download"
            >
              <Download size={16} />
            </a>
          </span>
        )}
      </div>
      <div
        className={`canvas${shown === "room" && photos.length ? " room-canvas" : ""}${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        {photos.length > 0 && (
          <div hidden={shown !== "room"} style={{ width: "100%" }}>
            <Suspense
              fallback={
                <div className="dropzone" role="status">
                  <LoaderCircle className="spin" size={22} />
                  Loading 3D room…
                </div>
              }
            >
              <RoomPreview key={room.id} state={state} />
            </Suspense>
          </div>
        )}
        {shown === "room" && photos.length ? null : shown === "compare" &&
          design &&
          comparisonKey ? (
          <>
            <img
              src={assetUrl(comparisonKey)}
              alt={design.guide ? "Captured 3D guide" : "Original photo"}
            />
            <div className="after" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
              <img src={assetUrl(design.key)} alt="Design" />
            </div>
            <div className="split-line" style={{ left: `${split}%` }}>
              <span>
                <MoveHorizontal size={16} />
              </span>
            </div>
            <input
              className="split-input"
              type="range"
              min="0"
              max="100"
              value={split}
              aria-label={
                design.guide ? "Compare 3D guide and design" : "Compare original and design"
              }
              onChange={(e) => setSplit(Number(e.target.value))}
            />
            <span className="tag left">{design.guide ? "3D guide" : "Before"}</span>
            <span className="tag right">After</span>
          </>
        ) : active ? (
          <img src={assetUrl(active.key)} alt="Design" />
        ) : base ? (
          <img src={assetUrl(base.key)} alt={base.name} />
        ) : (
          <div className="dropzone">
            <ImagePlus size={28} strokeWidth={1.5} />
            <p>Drop room photos here</p>
            <button className="button" disabled={locked} onClick={() => input.current?.click()}>
              Choose photos
            </button>
            <small className="muted">JPG, PNG or WebP · Up to 25 MB each</small>
          </div>
        )}
        {generating && (
          <div className="overlay" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={22} />
            <p>Generating…</p>
            <small>
              {count > 1
                ? `${count} designs, generated one at a time. Larger batches may take several minutes.`
                : "This can take a few minutes."}
            </small>
          </div>
        )}
        {shown === "design" && active?.mode === "freestyle" && (
          <span className="tag right">Freestyle · No input photo</span>
        )}
        {shown === "design" && active?.inferred && (
          <span className="tag right">AI finish · Includes inferred areas</span>
        )}
        {shown === "design" && active?.guide && (
          <span className="tag right">3D-guided · Estimated geometry</span>
        )}
      </div>
      {active?.guide && (
        <details className="design-guide-evidence">
          <summary>3D guide and source evidence</summary>
          <div>
            <a href={assetUrl(active.guide.key)} target="_blank" rel="noreferrer">
              <img src={assetUrl(active.guide.key)} alt="Saved 3D camera guide" />
            </a>
            <p>
              Guided by AI layout {active.guide.resultId}. Geometry and unseen areas are estimates.{" "}
              {active.guide.photoIds.length} original photos supplied appearance evidence;{" "}
              {active.guide.assetIds.length} selected references. Style: {active.guide.style}.
            </p>
            <p>
              Brief:{" "}
              {active.prompt || "Create a cohesive, comfortable, thoughtfully furnished interior."}
            </p>
            <a
              className="link-button"
              href={assetUrl(active.guide.layoutKey)}
              target="_blank"
              rel="noreferrer"
            >
              Inspect saved architectural constraints
            </a>
          </div>
        </details>
      )}
      {active?.plan && (
        <details className="plan">
          <summary>Layout plan</summary>
          <p>{active.plan}</p>
        </details>
      )}
      {editing && active && (
        <DesignEditor state={state} design={active} onClose={() => setEditing(false)} />
      )}
      {video && active && comparisonKey && (
        <CompareVideo
          design={active}
          beforeKey={comparisonKey}
          roomName={room.name}
          onClose={() => setVideo(false)}
        />
      )}
      {active?.generation && (
        <details className="design-details">
          <summary>
            {active.generation.quality === "auto"
              ? "Auto quality"
              : `${active.generation.quality === "xhigh" ? "Extra high" : active.generation.quality[0].toUpperCase() + active.generation.quality.slice(1)} quality`}
            {" · "}
            {active.generation.size.replace("x", " × ")}
            {" · PNG"}
          </summary>
          <p>{active.generation.model}</p>
          {active.generation.outputTokens !== undefined && (
            <p>
              {active.generation.outputTokens.toLocaleString()} output tokens
              {active.generation.outputCostUsd !== undefined &&
                ` · $${active.generation.outputCostUsd.toFixed(4)} image output`}
              . Input tokens are billed separately.
            </p>
          )}
          {active.promptKey && <DesignPrompt key={active.promptKey} promptKey={active.promptKey} />}
        </details>
      )}
      <Filmstrips state={state} />
    </section>
  );
}
