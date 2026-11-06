import { ENV } from "varlock/env";
import * as oidc from "openid-client";
import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { User } from "./types";
const issuer = () => ENV.AUTH_ISSUER || "https://auth.aranlucas.workers.dev/api/auth";
export const devBypass = () =>
  ENV.DEV_AUTH_BYPASS === true && ENV.NODE_ENV !== "production" && !ENV.VERCEL;
function key() {
  const secret = ENV.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Set SESSION_SECRET to at least 32 random characters.");
  return createHash("sha256").update(secret).digest();
}
export function cookie(req: Request, name: string) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export const appUrl = () => {
  if (!ENV.APP_URL) throw new Error("APP_URL is not configured.");
  return new URL(ENV.APP_URL).origin;
};
export function setCookie(name: string, value: string, age: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${appUrl().startsWith("https:") ? "; Secure" : ""}`;
}
export async function seal(data: Record<string, unknown>, expires = "7d") {
  return new EncryptJWT(data)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(expires)
    .encrypt(key());
}
export async function unseal(token?: string) {
  if (!token) return null;
  try {
    return (await jwtDecrypt(token, key())).payload;
  } catch {
    return null;
  }
}
export async function user(req: Request): Promise<User | null> {
  if (devBypass()) return { sub: "local-studio", name: "Local studio" };
  const p = await unseal(cookie(req, "roomform_session"));
  if (!p || typeof p.sub !== "string") return null;
  return {
    sub: p.sub,
    name: typeof p.name === "string" ? p.name : "Designer",
    email: typeof p.email === "string" ? p.email : undefined,
  };
}
export async function requireUser(req: Request) {
  const u = await user(req);
  if (!u) throw new Response("Sign in to continue.", { status: 401 });
  return u;
}
export function sameOrigin(req: Request) {
  if (req.headers.get("origin") !== appUrl())
    throw new Response("Origin not allowed.", { status: 403 });
}
let discovery: Promise<oidc.Configuration> | undefined;
function config() {
  if (!ENV.AUTH_CLIENT_ID)
    throw new Error("Register this app with your Auth service and set AUTH_CLIENT_ID.");
  return (discovery ??= oidc
    .discovery(
      new URL(`${issuer()}/.well-known/openid-configuration`),
      ENV.AUTH_CLIENT_ID,
      ENV.AUTH_CLIENT_SECRET || undefined,
      ENV.AUTH_CLIENT_SECRET ? oidc.ClientSecretBasic(ENV.AUTH_CLIENT_SECRET) : oidc.None(),
    )
    .catch((error) => {
      discovery = undefined;
      throw error;
    }));
}
export async function login() {
  const c = await config();
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = randomBytes(24).toString("hex");
  const url = oidc.buildAuthorizationUrl(c, {
    redirect_uri: `${appUrl()}/api/auth/callback`,
    scope: "openid profile email",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: await authorizationRedirect(url),
      "Set-Cookie": setCookie("roomform_login", await seal({ verifier, state, nonce }, "10m"), 600),
    },
  });
}
export async function callback(req: Request) {
  const p = await unseal(cookie(req, "roomform_login"));
  if (
    !p ||
    typeof p.verifier !== "string" ||
    typeof p.state !== "string" ||
    typeof p.nonce !== "string"
  )
    throw new Error("Login expired. Please sign in again.");
  const url = new URL(req.url);
  const canonical = new URL(`${appUrl()}/api/auth/callback`);
  canonical.search = url.search;
  const tokens = await oidc.authorizationCodeGrant(await config(), canonical, {
    pkceCodeVerifier: p.verifier,
    expectedState: p.state,
    expectedNonce: p.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("Auth did not return an identity.");
  const headers = new Headers({ Location: "/" });
  headers.append(
    "Set-Cookie",
    setCookie(
      "roomform_session",
      await seal({ sub: claims.sub, name: claims.name, email: claims.email }),
      604800,
    ),
  );
  headers.append("Set-Cookie", setCookie("roomform_login", "", 0));
  return new Response(null, { status: 302, headers });
}

// Better Auth returns a signed login destination as JSON for a signed-out authorization request.
// Resolve that handoff on the server so a normal browser navigation reaches the login UI.
export async function authorizationRedirect(url: URL): Promise<string> {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (
    response.status === 200 &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const data: unknown = await response.json();
    if (
      data &&
      typeof data === "object" &&
      "redirect" in data &&
      data.redirect === true &&
      "url" in data &&
      typeof data.url === "string"
    ) {
      const destination = new URL(data.url, url);
      if (destination.origin !== url.origin || !destination.pathname.startsWith("/auth/"))
        throw new Error("Auth returned an unexpected login destination.");
      return destination.href;
    }
    throw new Error("Auth did not return a login destination.");
  }
  if (!response.ok && response.status !== 302 && response.status !== 303)
    throw new Error("Auth is temporarily unavailable. Please try again.");
  return url.href;
}
