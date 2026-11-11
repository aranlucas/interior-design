import { Check, ExternalLink, Plus, Trash2 } from "lucide-react";
import { assetUrl } from "../lib/types";
import type { StudioState } from "../hooks/use-studio";
export function ReferencesList({ state }: { state: StudioState }) {
  const { refs, selected, setSelected, locked, setModal, setSizeAsset, deleteAsset } = state;
  return (
    <div className="field">
      <div className="field-head">
        <span>
          References
          {refs.length > 0 && (
            <em>
              {selected.length}/{refs.length}
            </em>
          )}
        </span>
        <button className="link-button" disabled={locked} onClick={() => setModal("reference")}>
          <Plus size={14} /> Add
        </button>
      </div>
      {refs.length ? (
        <ul className="refs">
          {refs.map((a) => {
            const on = selected.includes(a.id);
            return (
              <li key={a.id} className={on ? "ref on" : "ref"}>
                <button
                  className="ref-toggle"
                  aria-pressed={on}
                  aria-label={`${on ? "Exclude" : "Include"} ${a.name}`}
                  disabled={locked || (!on && selected.length >= 10)}
                  onClick={() =>
                    setSelected((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))
                  }
                >
                  <img src={assetUrl(a.key)} alt="" loading="lazy" decoding="async" />
                  <span className="check">{on && <Check size={11} strokeWidth={3} />}</span>
                </button>
                <div className="ref-text">
                  <strong title={a.name}>{a.name}</strong>
                  <span>
                    {a.kind === "product" ? "Product" : "Inspiration"} ·{" "}
                    <button
                      className="link-button"
                      disabled={locked}
                      onClick={() => setSizeAsset(a)}
                    >
                      {a.dimensions || (a.availableSizes?.length ? "Choose size" : "Add size")}
                    </button>
                  </span>
                </div>
                {a.url && (
                  <a
                    className="icon-button sm"
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${a.name} source`}
                    title="Open source"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
                <button
                  className="icon-button sm"
                  disabled={locked}
                  aria-label={`Remove ${a.name}`}
                  title="Remove"
                  onClick={() => void deleteAsset(a)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <button className="ref-empty" disabled={locked} onClick={() => setModal("reference")}>
          Add furniture or inspiration by link or image
        </button>
      )}
      {refs.length > 0 && (
        <p className="hint">Select up to 10 references to include in this design.</p>
      )}
    </div>
  );
}
