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
        <main className="center">
          <div className="card">
            <h1>Sign in</h1>
            <p className="muted">Use your account to open your rooms.</p>
            <a
              className="button primary block"
              href={
                session.authConfigured
                  ? "/api/auth/login"
                  : "https://auth.aranlucas.workers.dev/account"
              }
            >
              Continue
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
          <div className="card">
            <h1>New room</h1>
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
