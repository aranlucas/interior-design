import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useStudio } from "../hooks/use-studio";
import { RoomTypes } from "./studio-controls";
import { TopBar } from "./top-bar";
import { StudioStage } from "./studio-stage";
import { DesignPanel } from "./design-panel";
import { StudioDialogs } from "./studio-dialogs";
export function Studio({ roomId = "" }: { roomId?: string }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const state = useStudio(roomId);
  const { session, busy, room, signed, create } = state;
  return (
    <div className="app" data-room-id={roomId} inert={signed && !hydrated}>
      <TopBar state={state} />

      {!session ? (
        <main className="center">
          <LoaderCircle className="spin muted" size={20} aria-label="Loading" />
        </main>
      ) : !signed ? (
        <main className="center welcome">
          <FloorPlan />
          <div className="card welcome-card">
            <h1>Roomform</h1>
            <p>
              Redesign the rooms you already have. Upload photos, choose a style, and compare
              photoreal results against the original. Walls, windows and floors stay where they are.
            </p>
            <a
              className="button primary block"
              href={
                session.authConfigured
                  ? "/api/auth/login"
                  : "https://auth.aranlucas.workers.dev/account"
              }
            >
              Sign in
            </a>
            {!session.authConfigured && (
              <p className="hint">
                Sign-in isn’t configured. Register this app’s OIDC client with the auth service.
              </p>
            )}
          </div>
        </main>
      ) : !room ? (
        <main className="center">
          <div className="card wide">
            <h1>New room</h1>
            <p>Choose the kind of space. You can rename it later.</p>
            <RoomTypes busy={busy} onPick={(type) => void create(type)} />
          </div>
        </main>
      ) : (
        <main className="workspace">
          <StudioStage state={state} />

          <DesignPanel state={state} />
        </main>
      )}

      <StudioDialogs state={state} />
    </div>
  );
}

/** A measured plan of a small living room: the sign-in screen's only illustration. */
function FloorPlan() {
  return (
    <svg className="floor-plan" viewBox="0 0 320 260" aria-hidden>
      <g className="plan-dims">
        <path d="M40 22h240M40 16v12M280 16v12" />
        <text x="160" y="16">
          4.20 m
        </text>
        <path d="M298 40v180M292 40h12M292 220h12" />
        <text x="310" y="134" transform="rotate(90 310 130)">
          3.60 m
        </text>
      </g>
      <path className="plan-wall" d="M40 40h70m40 0h130v180H190m-50 0H40V40" />
      <path className="plan-window" d="M110 40h40" />
      <path className="plan-door" d="M140 220a50 50 0 0 1 50-50M190 220v-50" />
      <rect className="plan-item" x="62" y="60" width="128" height="44" rx="6" />
      <rect className="plan-item" x="94" y="124" width="64" height="34" rx="17" />
      <rect className="plan-item" x="214" y="70" width="44" height="44" rx="4" />
      <circle className="plan-tape" cx="236" cy="92" r="9" />
      <rect className="plan-rug" x="70" y="114" width="112" height="56" rx="2" />
    </svg>
  );
}
