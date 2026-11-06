import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, ImagePlus, X } from "lucide-react";
import { accept, roomTypes } from "../lib/studio-client";

export function Strip({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="strip">
      <span className="strip-label">
        {label}
        {action}
      </span>
      <div className="strip-items">{children}</div>
    </div>
  );
}

export function RoomTypes({ busy, onPick }: { busy: boolean; onPick: (type: string) => void }) {
  return (
    <div className="room-types">
      {roomTypes.map((type) => (
        <button key={type} className="button" disabled={busy} onClick={() => onPick(type)}>
          {type}
        </button>
      ))}
    </div>
  );
}

export function ReferenceForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const [source, setSource] = useState<"link" | "file">("link");
  const [file, setFile] = useState("");
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="segmented full" role="group" aria-label="Source">
        <button type="button" aria-pressed={source === "link"} onClick={() => setSource("link")}>
          Link
        </button>
        <button type="button" aria-pressed={source === "file"} onClick={() => setSource("file")}>
          Image
        </button>
      </div>
      {source === "link" ? (
        <label className="field">
          <span>Product link</span>
          <input name="url" type="url" required autoFocus placeholder="https://www.ikea.com/…" />
        </label>
      ) : (
        <label className="file">
          <ImagePlus size={18} />
          <span>{file || "Choose an image"}</span>
          <input
            type="file"
            name="file"
            required
            accept={accept}
            onChange={(e) => setFile(e.target.files?.[0]?.name || "")}
          />
        </label>
      )}
      <label className="field">
        <span>
          Name <em>optional</em>
        </span>
        <input
          name="name"
          maxLength={120}
          placeholder={source === "link" ? "From the page" : "From the file name"}
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Use as</span>
          <div className="select">
            <select name="kind">
              <option value="product">Product</option>
              <option value="inspiration">Inspiration</option>
            </select>
            <ChevronDown size={14} />
          </div>
        </label>
        <label className="field">
          <span>
            Size <em>optional</em>
          </span>
          <input name="dimensions" maxLength={200} placeholder="200 × 90 cm" />
        </label>
      </div>
      {source === "link" && (
        <p className="hint">Public product pages only. If a site blocks import, use an image.</p>
      )}
      <button className="button primary block" disabled={busy}>
        {busy ? "Adding…" : "Add reference"}
      </button>
    </form>
  );
}

export function Dialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-button sm" aria-label="Close" disabled={busy} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
