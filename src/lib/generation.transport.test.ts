import { afterAll, afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGeneration } from "./generation.server";
import * as storage from "./storage.server";

vi.mock("./layout.server", () => ({ analyzeLayout: vi.fn(async () => null) }));

const directory = mkdtempSync(join(tmpdir(), "roomform-image-transport-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("sends Max quality and 4K PNG through the installed SDK's actual image edit transport", async () => {
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const owner = "image-transport";
  const roomId = crypto.randomUUID();
  const baseId = crypto.randomUUID();
  const key = `${storage.ownerPrefix(owner)}${roomId}/photo.png`;
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRe8AAAAASUVORK5CYII=";
  await storage.save(key, Buffer.from(png, "base64"), "image/png");
  await storage.saveRooms(owner, [
    {
      id: roomId,
      name: "Living room",
      type: "Living room",
      notes: "",
      style: "Japandi",
      assets: [{ id: baseId, key, name: "Photo", kind: "room" }],
      designs: [],
      createdAt: new Date().toISOString(),
    },
  ]);
  let sent: FormData | undefined;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(String(url)).toBe("https://api.openai.com/v1/images/edits");
    sent = init?.body as FormData;
    return Response.json({
      created: 1,
      data: [{ b64_json: png }],
      usage: { output_tokens: 13000, input_tokens: 100, total_tokens: 13100 },
    });
  });
  const { jobId } = await startGeneration(owner, {
    roomId,
    baseId,
    notes: "Linen sofa",
    style: "Japandi",
    assetIds: [],
  });
  await vi.waitFor(() => expect(storage.getJob(owner, jobId)?.status).toBe("succeeded"));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sent?.get("model")).toBe("gpt-image-2.6-sunburst");
  expect(sent?.get("quality")).toBe("max");
  expect(sent?.get("size")).toBe("3840x2160");
  expect(sent?.get("output_format")).toBe("png");
  expect(sent?.getAll("image")).toHaveLength(1);
  expect((await storage.rooms(owner))[0].designs[0].generation?.outputTokens).toBe(13000);
  expect(await storage.load((await storage.rooms(owner))[0].designs[0].key)).toEqual(
    new Uint8Array(Buffer.from(png, "base64")),
  );
});
