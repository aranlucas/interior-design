import { afterEach, expect, it, vi } from "vitest";
import { analyzeLayout } from "./layout.server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(["image/png", undefined])(
  "sends the room photo without deprecated content warnings (mediaType: %s)",
  async (mediaType) => {
    vi.stubEnv("OPENAI_API_KEY", "transport-test-key");
    const warnings = vi.fn();
    vi.stubGlobal("AI_SDK_LOG_WARNINGS", warnings);
    let requestBody: { messages: { content: unknown }[] } | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        id: "chatcmpl_test",
        object: "chat.completion",
        created: 1,
        model: "layout-test-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({ roomEstimate: "4 m wide", placements: [] }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    });
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRe8AAAAASUVORK5CYII=";
    const result = await analyzeLayout({
      mode: "empty",
      baseImage: Buffer.from(base64, "base64"),
      mediaType,
      roomType: "living room",
      references: [],
      style: "minimal",
      brief: "",
    });

    expect(result).toBe("Estimated room geometry: 4 m wide.");
    expect(requestBody?.messages[1].content).toContainEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${base64}` },
    });
    expect(warnings.mock.calls.flatMap(([options]) => options.warnings)).not.toContainEqual(
      expect.objectContaining({ type: "deprecated", setting: '"image" content part' }),
    );
  },
);
