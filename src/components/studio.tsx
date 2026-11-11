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
          <div className="welcome-art" aria-hidden>
            <span className="welcome-window" />
            <span className="welcome-sofa" />
            <span className="welcome-lamp" />
          </div>
          <div className="card welcome-card">
            <p className="eyebrow">Interior studio</p>
            <h1>Reimagine the rooms you already have.</h1>
            <p className="muted">
              Upload a few photos, pick a direction, and render photoreal redesigns — keeping your
              walls, windows and floors where they are.
            </p>
            <a
              className="button primary block"
              href={
                session.authConfigured
                  ? "/api/auth/login"
                  : "https://auth.aranlucas.workers.dev/account"
              }
            >
              Sign in to continue
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
            <p className="eyebrow">Start a project</p>
            <h1>New room</h1>
            <p className="muted">Which space are you working on? You can rename it later.</p>
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
