import {
  Brush,
  ChevronDown,
  ChevronRight,
  Eraser,
  LoaderCircle,
  PaintRoller,
  PenTool,
  Sofa,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { RoomSizeFields } from "./room-size-fields";
import { ReferencesList } from "./references-list";
import {
  styleGroups,
  modes,
  peopleChoices,
  lightingChoices,
  orientationChoices,
  type People,
  type Lighting,
  type Orientation,
} from "../lib/studio-client";
import type { StudioState } from "../hooks/use-studio";
import { ImageSettings } from "./image-settings";
import { qualityOptions, sizeOptions } from "../lib/image-settings";
import type { Mode } from "../lib/studio-client";

const modeIcons: Record<Mode, LucideIcon> = {
  redesign: Wand2,
  stage: Sofa,
  paint: PaintRoller,
  empty: Eraser,
  sketch: PenTool,
  freestyle: Sparkles,
};

const shortLabel = (label: string | undefined) => label?.split(" · ")[0] ?? "";
export function DesignPanel({ state }: { state: StudioState }) {
  const {
    generating,
    saveStatus,
    draftFields,
    refine,
    setRefine,
    mode,
    setMode,
    measurements,
    setMeasurements,
    count,
    setCount,
    orientation,
    setOrientation,
    people,
    setPeople,
    lighting,
    setLighting,
    base,
    active,
    locked,
    generate,
  } = state;
  const session = state.session!;
  const failed = state.job?.roomId === state.roomId && state.job.status === "failed";
  const freestyle = mode === "freestyle";
  const canGenerate = !!base || freestyle;
  const sceneSummary = [
    lighting[0].toUpperCase() + lighting.slice(1) + " light",
    people !== "none" && people[0].toUpperCase() + people.slice(1),
    measurements ? "Sized" : "Size unknown",
  ]
    .filter(Boolean)
    .join(" · ");
  const outputSummary = [
    shortLabel(qualityOptions.find((o) => o.value === state.imageSettings.quality)?.label),
    freestyle
      ? orientation[0].toUpperCase() + orientation.slice(1)
      : shortLabel(sizeOptions.find((o) => o.value === state.imageSettings.size)?.label),
  ].join(" · ");
  return (
    <aside className="panel" aria-label="Design brief and image settings">
      <div className="panel-body">
        <section className="panel-section" aria-labelledby="mode-heading">
          <h2 id="mode-heading" className="section-label">
            Mode
          </h2>
          <div className="mode-grid" role="group" aria-label="Design mode">
            {modes.map((m) => {
              const Icon = modeIcons[m.id] ?? Brush;
              return (
                <button
                  key={m.id}
                  type="button"
                  className="mode-card"
                  aria-pressed={mode === m.id}
                  disabled={locked || (!base && m.id !== "freestyle")}
                  onClick={() => setMode(m.id)}
                >
                  <Icon size={16} strokeWidth={1.6} aria-hidden />
                  {m.label}
                </button>
              );
            })}
          </div>
          <p className="hint">{modes.find((m) => m.id === mode)?.hint}</p>
        </section>
        <label className="field">
          <span>Style</span>
          <div className="select">
            <select {...draftFields.style}>
              {styleGroups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
        </label>
        {freestyle && (
          <div className="field">
            <div className="field-head">
              <span>Orientation</span>
            </div>
            <div className="segmented full" role="group" aria-label="Orientation">
              {orientationChoices.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={orientation === o.id}
                  disabled={locked}
                  onClick={() => setOrientation(o.id as Orientation)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="field">
          <span>Brief</span>
          <textarea
            {...draftFields.notes}
            maxLength={4000}
            rows={5}
            placeholder="Keep the floors. Linen sofa by the window, oak side table."
          />
        </label>
        <ReferencesList state={state} />
        <details className="disclosure">
          <summary>
            <span>Scene</span>
            <span className="disclosure-summary">{sceneSummary}</span>
            <ChevronRight size={14} aria-hidden />
          </summary>
          <div className="disclosure-body">
            <div className="field-row">
              <label className="field">
                <span>
                  People <em>optional</em>
                </span>
                <div className="select">
                  <select value={people} onChange={(e) => setPeople(e.target.value as People)}>
                    {peopleChoices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </label>
              <label className="field">
                <span>Lighting</span>
                <div className="select">
                  <select
                    value={lighting}
                    onChange={(e) => setLighting(e.target.value as Lighting)}
                  >
                    {lightingChoices.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </label>
            </div>
            <RoomSizeFields
              key={state.roomId}
              value={measurements}
              onChange={setMeasurements}
              disabled={locked}
            />
          </div>
        </details>
        <details className="disclosure">
          <summary>
            <span>Output</span>
            <span className="disclosure-summary">{outputSummary}</span>
            <ChevronRight size={14} aria-hidden />
          </summary>
          <div className="disclosure-body">
            <ImageSettings
              value={state.imageSettings}
              onChange={state.setImageSettings}
              model={session.imageModel}
              sizeNote={
                freestyle
                  ? "Output size follows the orientation above: 1536 × 1024 landscape, 1024 × 1536 portrait, or 1024 × 1024 square."
                  : undefined
              }
              disabled={generating}
            />
          </div>
        </details>
      </div>
      <div className="panel-foot">
        {saveStatus && (
          <span className="muted small" role="status">
            {saveStatus}
          </span>
        )}
        {active && (
          <label className="checkbox">
            <input type="checkbox" checked={refine} onChange={(e) => setRefine(e.target.checked)} />{" "}
            Refine this design
          </label>
        )}
        <div className="dock-row">
          <span className="dock-label">Variations</span>
          <div className="segmented" role="group" aria-label="Designs to generate">
            {([1, 2, 4, 8] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={count === n}
                disabled={locked}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        {count > 1 && (
          <p className="hint">
            Variations run one at a time and may take longer. Each variation is billed separately,
            including its input images.
          </p>
        )}
        {failed && !generating && (
          <p className="generation-error" role="status">
            {state.job?.error}
          </p>
        )}
        <button
          className="button accent block generate"
          disabled={!canGenerate || locked || !session.generationConfigured}
          onClick={() => void generate()}
        >
          {generating ? (
            <>
              <LoaderCircle size={16} className="spin" /> Generating…
            </>
          ) : failed ? (
            "Try again"
          ) : (
            <>
              <Sparkles size={16} aria-hidden />
              {refine
                ? "Refine"
                : count > 1
                  ? `Generate ${count}`
                  : freestyle
                    ? "Generate freestyle"
                    : state.shown === "room"
                      ? "Generate from photo"
                      : "Generate image"}
            </>
          )}
        </button>
        {state.shown === "room" && base && (
          <p className="hint">For the 3D camera angle, capture a view in the room preview.</p>
        )}
        {!session.generationConfigured ? (
          <p className="hint">Image generation isn’t configured. The 3D room works without AI.</p>
        ) : !canGenerate ? (
          <p className="hint">Add a room photo to generate.</p>
        ) : null}
      </div>
    </aside>
  );
}
