import { afterEach, expect, it, vi } from "vitest";
import * as oidc from "openid-client";
import { login } from "./auth.server";

vi.mock("openid-client", () => ({
  discovery: vi.fn(),
  None: vi.fn(),
  randomPKCECodeVerifier: () => "verifier",
  randomState: () => "state",
  calculatePKCECodeChallenge: async () => "challenge",
  buildAuthorizationUrl: () => new URL("https://issuer.example/authorize"),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// A temporary issuer outage must not require restarting the app to sign in.
it("retries failed discovery and caches successful discovery for later logins", async () => {
  vi.stubEnv("AUTH_CLIENT_ID", "test-client");
  vi.stubEnv("AUTH_CLIENT_SECRET", "");
  vi.stubEnv("APP_URL", "https://roomform.example");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-with-at-least-32-characters");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 302 })),
  );
  vi.mocked(oidc.discovery)
    .mockRejectedValueOnce(new Error("Temporary issuer outage"))
    .mockResolvedValueOnce({} as oidc.Configuration);
  await expect(login()).rejects.toThrow("Temporary issuer outage");
  const recovery = login();
  await expect(recovery).resolves.toMatchObject({ status: 302 });
  const recovered = await recovery;
  expect(recovered.status).toBe(302);
  expect(recovered.headers.get("Location")).toBe("https://issuer.example/authorize");
  expect(recovered.headers.get("Set-Cookie")).toContain("roomform_login=");
  expect((await login()).status).toBe(302);
  expect(oidc.discovery).toHaveBeenCalledTimes(2);
});
