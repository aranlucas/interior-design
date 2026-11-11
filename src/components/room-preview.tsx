import { lazy, Suspense, useState } from "react";
import { Box, ImagePlus, LoaderCircle, Sparkles } from "lucide-react";
import type { StudioState } from "../hooks/use-studio";
import { useReconstruction } from "../hooks/use-reconstruction";
import { reconstructionIsCurrent } from "../lib/reconstruction";
import { PhotoMatcher } from "./photo-matcher";
import { ReconstructedRoomScene } from "./reconstructed-room-scene";
import { AiRoomLayoutScene } from "./ai-room-layout-scene";
const ManualRoomPreview = lazy(() => import("./manual-room-preview"));

export default function RoomPreview({ state }: { state: StudioState }) {
  const { status, scene, build, cancel, saveLayout } = useReconstruction(state);
  const [matching, setMatching] = useState(false);
  const [manual, setManual] = useState(false);
  const [mode, setMode] = useState<"classical" | "ai-layout">(
    state.room!.reconstruction?.mode ?? "classical",
  );
  const job = state.room!.reconstruction;
  const busy = job?.status === "running" || build.isPending;
  const result = job?.result;
  const outdated = result && !reconstructionIsCurrent(result, state.photos);
  const error = build.error || cancel.error || status.error || scene.error;
  const ready =
    mode === "ai-layout" ? status.data?.aiAvailable === true : status.data?.available === true;
  const aiResult = scene.data?.kind === "ai-layout" && scene.data.layout;
  return (
    <div className="room-preview">
      <div className="room-preview-heading">
        <div>
          <h2>Your room in 3D</h2>
          <p>Upload different angles. We’ll work out how they fit together.</p>
        </div>
        <span className={`room-method${aiResult ? " ai" : ""}`}>
          {aiResult ? "AI-estimated" : "Photo reconstruction"}
        </span>
      </div>
      {aiResult ? (
        <AiRoomLayoutScene
          key={result!.id}
          layout={aiResult}
          resultId={result!.id}
          disabled={state.locked || busy || !!outdated || !state.session?.generationConfigured}
          products={state.refs
            .filter((asset) => asset.kind === "product")
            .map((asset) => ({ id: asset.id, name: asset.name, dimensions: asset.dimensions }))}
          onSave={(layout) => saveLayout.mutateAsync(layout)}
          onGenerate={(roomGuide, placed) =>
            void state.generate({
              roomGuide,
              // Placed products need their photos; keep the client's selection order first.
              assetIds: [...new Set([...state.selected, ...placed])].slice(0, 10),
            })
          }
        />
      ) : scene.data ? (
        <ReconstructedRoomScene data={scene.data} photos={state.photos} />
      ) : (
        <div className="reconstruction-empty">
          {busy ? (
            <LoaderCircle size={30} className="spin" />
          ) : (
            <Box size={36} strokeWidth={1.25} />
          )}
          <h3>{busy ? job?.stage || "Starting room build" : "Build from your room photos"}</h3>
          <p>
            {busy
              ? job?.mode === "ai-layout"
                ? "Estimating architecture and fixed furnishings from your room photos. This may take a few minutes."
                : "Matching shared details and recovering camera positions. This may take several minutes."
              : "Add overlapping photos of the same room, then build. No wall labels or measurements needed."}
          </p>
        </div>
      )}
      <div className="reconstruction-controls">
        <div
          className="segmented room-build-method"
          role="group"
          aria-label="Reconstruction method"
        >
          <button
            disabled={busy}
            aria-pressed={mode === "classical"}
            onClick={() => setMode("classical")}
          >
            Photo matching
          </button>
          <button
            disabled={busy}
            aria-pressed={mode === "ai-layout"}
            onClick={() => setMode("ai-layout")}
          >
            <Sparkles size={13} /> AI-assisted
          </button>
        </div>
        {mode === "ai-layout" && (
          <p className="room-help">
            AI analyzes up to eight room photos to estimate walls, openings, and fixtures. Your
            photos are sent to OpenAI. Proportions and unseen structure are inferred.
          </p>
        )}
        <div className="room-build-actions">
          <button
            className="button primary"
            disabled={
              busy || state.busy || !ready || state.photos.length < (mode === "ai-layout" ? 1 : 2)
            }
            onClick={() => {
              build.reset();
              void build.mutateAsync({ mode }).catch(() => {});
            }}
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <Box size={16} />}
            {busy
              ? "Building 3D room…"
              : mode === "ai-layout"
                ? "Build AI room layout"
                : result
                  ? "Rebuild 3D room"
                  : "Build 3D room"}
          </button>
          {busy ? (
            <button
              className="button ghost"
              disabled={cancel.isPending || build.isPending || job?.status !== "running"}
              onClick={() => cancel.mutate()}
            >
              Cancel build
            </button>
          ) : (
            <button
              className="button ghost"
              disabled={state.locked}
              onClick={() => state.input.current?.click()}
            >
              <ImagePlus size={15} />
              Add photos
            </button>
          )}
          <span className="room-help">
            {state.photos.length} room photo{state.photos.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="room-build-status" role="status">
          {busy
            ? job?.stage || "Starting…"
            : result?.kind === "ai-layout"
              ? `AI-estimated layout from ${result.sourcePhotoIds?.length ?? result.photoIds.length} source photos, ${result.fixtureCount ?? 0} fixtures`
              : result
                ? `${result.registeredIds.length} of ${result.photoIds.length} photos aligned, ${result.pointCount.toLocaleString()} recovered points`
                : mode === "ai-layout"
                  ? state.photos.length
                    ? "Use several views of the same room for a more complete estimate."
                    : "Add a room photo to start. Several views work better."
                  : state.photos.length < 2
                    ? "Add at least two overlapping angles to start. More overlapping views work better."
                    : "Use photos taken from different positions, with shared details visible in each."}
        </p>
        {status.data && !ready && (
          <p className="room-help" role="alert">
            {mode === "ai-layout"
              ? "AI-assisted builds aren’t configured on this server yet."
              : "Photo reconstruction isn’t available on this server. You can still use a manual layout below."}
          </p>
        )}
        {outdated && (
          <p className="room-help">
            Photos have changed since this preview was built. Rebuild to include the current photos.
          </p>
        )}
        {result &&
          result.kind !== "ai-layout" &&
          result.registeredIds.length < result.photoIds.length && (
            <p className="room-help">
              Some photos couldn’t be aligned. Add closer angles or help match photo details to
              connect them.
            </p>
          )}
        {result && result.components > 1 && (
          <p className="room-help">
            The photos formed separate groups. This preview shows the largest connected group.
          </p>
        )}
        {job?.status === "failed" && (
          <p className="room-build-error" role="alert">
            {job.error}
          </p>
        )}
        {job?.status === "cancelled" && (
          <p className="room-help">Build cancelled. You can start again whenever you’re ready.</p>
        )}
        {error && (
          <p className="room-build-error" role="alert">
            {error.message}
          </p>
        )}
        {scene.isLoading && (
          <p className="room-help" role="status">
            Loading saved 3D preview…
          </p>
        )}
        <div className="room-build-actions">
          <button
            className="link-button"
            disabled={state.photos.length < 2 || busy || mode === "ai-layout"}
            aria-expanded={matching}
            onClick={() => setMatching((v) => !v)}
          >
            {matching ? "Hide photo matching" : "Help match photo details"}
          </button>
          <button
            className="link-button"
            aria-expanded={manual}
            onClick={() => setManual((v) => !v)}
          >
            {manual ? "Hide manual layout" : "Use a manual layout"}
          </button>
        </div>
        {matching && mode === "classical" && (
          <PhotoMatcher
            photos={state.photos}
            busy={busy}
            onBuild={(matches) => {
              build.reset();
              void build.mutateAsync({ matches, mode: "classical" }).catch(() => {});
            }}
          />
        )}
      </div>
      {!aiResult && (result || job?.status === "failed") && (
        <div className="room-ai-finish">
          <div>
            <h3>Fill visual gaps with AI</h3>
            <p className="room-help">
              Create a separate finished image from your room photos. Unseen areas are inferred;
              they are not measured geometry.
            </p>
          </div>
          <button
            className="button"
            disabled={state.locked || !state.session?.generationConfigured}
            onClick={() => void state.generate({ fillGaps: true })}
          >
            Create AI finish
          </button>
          {!state.session?.generationConfigured && (
            <p className="room-help">
              AI image generation isn’t configured. The 3D build works independently.
            </p>
          )}
        </div>
      )}
      <p className="room-disclosure">
        {aiResult ? (
          "This is an AI-estimated architectural layout, not a measured reconstruction. Fixture shapes are simplified. Verify dimensions and openings before making fit or renovation decisions."
        ) : (
          <>
            This preview recovers colored points and camera positions from shared photo details.
            Gaps stay visible. It is a partial reconstruction, not a solid room model or a source of
            physical measurements.
          </>
        )}
      </p>
      {manual && (
        <div className="room-manual">
          <Suspense fallback={<p className="room-help">Loading manual layout…</p>}>
            <ManualRoomPreview state={state} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
