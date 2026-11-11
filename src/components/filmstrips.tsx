import { useEffect, useRef, useState } from "react";
import { Plus, Star, X } from "lucide-react";
import { assetUrl, type Room } from "../lib/types";
import { accept, api, makePreview, studioUrls } from "../lib/studio-client";
import { Strip } from "./studio-controls";
import type { StudioState } from "../hooks/use-studio";
/**
 * Give each design a small stored preview, one at a time. A design's full PNG can be many MB;
 * after this one-time download (usually already cached by the stage), the strip loads ~50 KB.
 */
function useDesignPreviews(room: Room, update: StudioState["update"]) {
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    const pending = room.designs.filter((d) => !d.previewKey && !attempted.current.has(d.id));
    if (!pending.length) return;
    let cancelled = false;
    void (async () => {
      for (const design of pending) {
        if (cancelled) return;
        attempted.current.add(design.id);
        try {
          const response = await fetch(assetUrl(design.key));
          if (!response.ok) continue;
          const data = new FormData();
          data.set("roomId", room.id);
          data.set("designId", design.id);
          data.set("preview", await makePreview(await response.blob()), "preview.jpeg");
          const updated = await api<Room>(studioUrls.designPreview, { method: "POST", body: data });
          if (!cancelled) await update(updated);
        } catch {
          // Optional: the strip falls back to the full image.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room.id, room.designs, update]);
}
export function Filmstrips({ state }: { state: StudioState }) {
  const {
    photos,
    shown,
    base,
    design,
    locked,
    setBaseId,
    setDesignId,
    setView,
    deleteAsset,
    deleteDesign,
    input,
    active,
    generating,
    upload,
  } = state;
  const room = state.room!;
  useDesignPreviews(room, state.update);
  const [savedOnly, setSavedOnly] = useState(false);
  const starredCount = room.designs.filter((d) => d.starred).length;
  if (savedOnly && starredCount === 0) setSavedOnly(false);
  const designs = savedOnly ? room.designs.filter((d) => d.starred) : room.designs;
  return (
    <div className="strips">
      <Strip label="Photos">
        {photos.map((a) => (
          <div className="thumb-wrap" key={a.id}>
            <button
              className="thumb"
              aria-pressed={
                (shown === "photo" && base?.id === a.id) ||
                ((shown === "design" || shown === "compare") && !!design && design.baseId === a.id)
              }
              disabled={locked}
              aria-label={`Show ${a.name}`}
              onClick={() => {
                setBaseId(a.id);
                setDesignId("");
                setView("photo");
              }}
            >
              <img src={assetUrl(a.key)} alt="" loading="lazy" decoding="async" />
            </button>
            <button
              className="thumb-delete"
              aria-label={`Delete photo ${a.name}`}
              title="Delete photo"
              disabled={locked}
              onClick={() => void deleteAsset(a)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          className="thumb add"
          disabled={locked}
          aria-label="Add photos"
          title="Add photos"
          onClick={() => input.current?.click()}
        >
          <Plus size={18} />
        </button>
      </Strip>
      {room.designs.length > 0 && (
        <Strip
          label={savedOnly ? "Saved" : "Designs"}
          action={
            starredCount > 0 || savedOnly ? (
              <button
                className="link-button"
                aria-pressed={savedOnly}
                onClick={() => setSavedOnly((v) => !v)}
              >
                {savedOnly ? "Show all" : `Saved ${starredCount}`}
              </button>
            ) : undefined
          }
        >
          {designs.map((d, i) => (
            <div className="thumb-wrap" key={d.id}>
              <button
                className="thumb"
                aria-pressed={active?.id === d.id}
                disabled={generating}
                aria-label={`Show design ${designs.length - i}`}
                title={d.createdAt}
                onClick={() => {
                  setDesignId(d.id);
                  setBaseId(d.baseId);
                  setView("design");
                }}
              >
                <img src={assetUrl(d.previewKey ?? d.key)} alt="" loading="lazy" decoding="async" />
              </button>
              {d.starred && (
                <span className="thumb-star" aria-label="Saved design">
                  <Star size={11} />
                </span>
              )}
              <button
                className="thumb-delete"
                disabled={locked}
                aria-label={`Delete design ${designs.length - i}`}
                title="Delete design"
                onClick={() => void deleteDesign(d.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </Strip>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept={accept}
        multiple
        onChange={(e) => {
          void upload(e.target.files, "room");
          e.target.value = "";
        }}
      />
    </div>
  );
}
