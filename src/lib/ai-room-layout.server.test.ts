import { afterEach, expect, it, vi } from "vitest";
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
}));
import { generateText } from "ai";
import { runAiRoomLayout, selectAiRoomPhotos } from "./ai-room-layout.server";
import { exampleAiRoomLayout } from "./ai-room-layout.fixture";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("reviews all supplied room views in two private structured vision requests and records AI provenance", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.mocked(generateText).mockResolvedValue({ output: exampleAiRoomLayout() } as Awaited<
    ReturnType<typeof generateText>
  >);
  const photos = Array.from({ length: 4 }, (_, i) => ({
    id: crypto.randomUUID(),
    name: `Room ${i + 1}`,
    key: `photo-${i}.jpeg`,
    kind: "room" as const,
  }));
  const loadPhoto = vi.fn(async () => new Uint8Array([1, 2]));
  const result = await runAiRoomLayout({
    photos,
    measurements: "4 m wide, 6 m deep",
    loadPhoto,
    progress: vi.fn(),
    signal: AbortSignal.timeout(10_000),
  });
  expect(loadPhoto).toHaveBeenCalledTimes(4);
  expect(generateText).toHaveBeenCalledTimes(2);
  const review = vi.mocked(generateText).mock.calls[1][0];
  const reviewContent = review.messages?.[0].content;
  expect(
    Array.isArray(reviewContent) && reviewContent.filter((p) => p.type === "file"),
  ).toHaveLength(4);
  expect(JSON.stringify(review.messages)).toContain("4 m wide, 6 m deep");
  expect(JSON.stringify(review.messages)).toContain("Candidate layout");
  const options = vi.mocked(generateText).mock.calls[0][0];
  const messages = options.messages;
  expect(messages?.[0].role).toBe("user");
  expect(messages).toHaveLength(1);
  expect(options.instructions).toBeTypeOf("string");
  const content = messages?.[0].content;
  expect(Array.isArray(content) && content.filter((part) => part.type === "file")).toHaveLength(4);
  expect(options.providerOptions).toEqual({ openai: { store: false, reasoningEffort: "high" } });
  expect(options.maxRetries).toBe(0);
  expect(result.scene).toMatchObject({
    kind: "ai-layout",
    sourcePhotoIds: photos.map((p) => p.id),
    model: "gpt-6.1-sol",
    cameras: [],
    positions: [],
  });
  expect(result.scene.layout).toEqual(exampleAiRoomLayout());
});

// An overhanging rotated fixture must be repaired, not stored as successful geometry.
it("passes geometric feedback to the photo review and stores only the corrected layout", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const draft = exampleAiRoomLayout();
  draft.fixtures[0].x = 0;
  const corrected = exampleAiRoomLayout();
  corrected.floorMaterial = "wood";
  corrected.fixtures[0].material = "paint";
  vi.mocked(generateText)
    .mockResolvedValueOnce({ output: draft } as never)
    .mockResolvedValueOnce({ output: corrected } as never);
  const result = await runAiRoomLayout({
    photos: [{ id: "one", key: "one.jpeg", name: "Room", kind: "room" }],
    loadPhoto: async () => new Uint8Array([1]),
    progress: async () => {},
    signal: AbortSignal.timeout(10000),
  });
  expect(JSON.stringify(vi.mocked(generateText).mock.calls[1][0].messages)).toContain(
    "extends outside the room",
  );
  expect(result.scene.layout).toEqual(corrected);
});

it("rejects invalid reviewed geometry instead of silently saving the draft", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const invalid = exampleAiRoomLayout();
  invalid.fixtures[0].height = 5;
  vi.mocked(generateText)
    .mockResolvedValueOnce({ output: exampleAiRoomLayout() } as never)
    .mockResolvedValueOnce({ output: invalid } as never);
  await expect(
    runAiRoomLayout({
      photos: [{ id: "one", key: "one.jpeg", name: "Room", kind: "room" }],
      loadPhoto: async () => new Uint8Array([1]),
      progress: async () => {},
      signal: AbortSignal.timeout(10000),
    }),
  ).rejects.toThrow("ceiling");
});

it("covers the whole photo sequence within the eight-view budget and retains evidence order", () => {
  const photos = Array.from({ length: 16 }, (_, i) => ({
    id: String(i),
    key: String(i),
    name: String(i),
    kind: "room" as const,
  }));
  const chosen = selectAiRoomPhotos(photos);
  expect(chosen).toHaveLength(8);
  expect(chosen[0]).toBe(photos[0]);
  expect(chosen.at(-1)).toBe(photos[15]);
  expect(new Set(chosen).size).toBe(8);
  expect(chosen.map((p) => photos.indexOf(p))).toEqual(
    chosen.map((p) => photos.indexOf(p)).sort((a, b) => a - b),
  );
  expect(selectAiRoomPhotos(photos.slice(0, 4))).toEqual(photos.slice(0, 4));
});
