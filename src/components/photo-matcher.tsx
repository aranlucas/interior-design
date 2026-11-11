import { useState, type MouseEvent } from "react";
import { ChevronDown, Crosshair, Undo2 } from "lucide-react";
import { assetUrl, type Asset } from "../lib/types";
import type { PhotoMatches } from "../lib/reconstruction";

export function PhotoMatcher({
  photos,
  busy,
  onBuild,
}: {
  photos: Asset[];
  busy: boolean;
  onBuild: (matches: PhotoMatches) => void;
}) {
  const [aId, setAId] = useState(photos[0]?.id ?? "");
  const [bId, setBId] = useState(photos[1]?.id ?? "");
  const [points, setPoints] = useState<PhotoMatches["points"]>([]);
  const [pending, setPending] = useState<[number, number] | null>(null);
  const [focus, setFocus] = useState<"a" | "b" | null>(null);
  const [cursor, setCursor] = useState({ a: [0.5, 0.5], b: [0.5, 0.5] });
  const valid = aId !== bId && [aId, bId].every((id) => photos.some((p) => p.id === id));
  function click(event: MouseEvent<HTMLButtonElement>, side: "a" | "b") {
    if (!valid || busy || points.length >= 64) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point: [number, number] =
      event.detail === 0
        ? [cursor[side][0], cursor[side][1]]
        : [
            Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
            Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
          ];
    if (side === "a") setPending(point);
    else if (pending) {
      setPoints((current) => [...current, { a: pending, b: point }]);
      setPending(null);
    }
  }
  return (
    <div className="photo-matcher">
      <h3>Help match two photos</h3>
      <p className="room-help">
        Click a detail in the first photo, then the same detail in the second. Use at least 12
        distinct points spread across nearby and distant objects. Avoid reflections and repeated
        patterns.
      </p>
      <div className="match-photo-grid">
        {(["a", "b"] as const).map((side) => {
          const id = side === "a" ? aId : bId;
          const photo = photos.find((p) => p.id === id);
          return (
            <div key={side}>
              <label className="field">
                <span>{side === "a" ? "First photo" : "Second photo"}</span>
                <div className="select">
                  <select
                    disabled={busy}
                    value={id}
                    onChange={(e) => {
                      (side === "a" ? setAId : setBId)(e.target.value);
                      setPoints([]);
                      setPending(null);
                    }}
                  >
                    {photos.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </label>
              {photo && (
                <button
                  type="button"
                  className="match-photo"
                  disabled={!valid || busy || (side === "b" && !pending)}
                  aria-label={
                    side === "a"
                      ? "Mark a detail in the first photo"
                      : "Mark the same detail in the second photo"
                  }
                  onClick={(e) => click(e, side)}
                  onFocus={() => setFocus(side)}
                  onBlur={() => setFocus(null)}
                  onKeyDown={(event) => {
                    if (!event.key.startsWith("Arrow")) return;
                    event.preventDefault();
                    setCursor((current) => {
                      const next = [...current[side]];
                      const step = event.shiftKey ? 0.002 : 0.02;
                      if (event.key === "ArrowLeft") next[0] -= step;
                      if (event.key === "ArrowRight") next[0] += step;
                      if (event.key === "ArrowUp") next[1] -= step;
                      if (event.key === "ArrowDown") next[1] += step;
                      return { ...current, [side]: next.map((v) => Math.max(0, Math.min(1, v))) };
                    });
                  }}
                >
                  <img src={assetUrl(photo.key)} alt={photo.name} draggable={false} />
                  {focus === side && (
                    <Crosshair
                      className="match-crosshair"
                      size={22}
                      style={{
                        left: `${cursor[side][0] * 100}%`,
                        top: `${cursor[side][1] * 100}%`,
                      }}
                    />
                  )}
                  {points.map((point, index) => (
                    <span
                      className="match-point"
                      key={index}
                      style={{ left: `${point[side][0] * 100}%`, top: `${point[side][1] * 100}%` }}
                    >
                      {index + 1}
                    </span>
                  ))}
                  {side === "a" && pending && (
                    <span
                      className="match-point pending"
                      style={{ left: `${pending[0] * 100}%`, top: `${pending[1] * 100}%` }}
                    >
                      {points.length + 1}
                    </span>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!valid && (
        <p className="room-help" role="alert">
          Choose two different photos.
        </p>
      )}
      <div className="room-build-actions">
        <span className="room-help" role="status">
          {points.length} pairs matched
          {pending ? ". Now click the same detail in the second photo" : ""}
        </span>
        <button
          className="button ghost"
          type="button"
          disabled={busy || (!points.length && !pending)}
          onClick={() => {
            if (pending) setPending(null);
            else setPoints((p) => p.slice(0, -1));
          }}
        >
          <Undo2 size={14} />
          Undo
        </button>
        <button
          className="button"
          type="button"
          disabled={!valid || points.length < 12 || busy || !!pending}
          onClick={() => onBuild({ aId, bId, points })}
        >
          Build with matches
        </button>
      </div>
      <p className="room-help">
        Matching helps alignment; it still needs visible overlap and camera movement between shots.
        Keyboard: arrow keys move the crosshair, Shift makes fine adjustments, and Enter marks a
        detail.
      </p>
    </div>
  );
}
