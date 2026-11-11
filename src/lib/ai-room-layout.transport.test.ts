import { afterEach, expect, it, vi } from "vitest";
import { runAiRoomLayout } from "./ai-room-layout.server";
import { exampleAiRoomLayout } from "./ai-room-layout.fixture";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("serializes the installed SDK's real vision request with structured output and private storage disabled", async () => {
  vi.stubEnv("OPENAI_API_KEY", "transport-test-key");
  let requests = 0;
  let requestBody: Record<string, unknown> | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    requests++;
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      id: "resp_test",
      object: "response",
      created_at: 1,
      model: "gpt-6.1-sol",
      status: "completed",
      output: [
        {
          id: "msg_test",
          type: "message",
          role: "assistant",
          status: "completed",
          phase: "final_answer",
          content: [
            { type: "output_text", text: JSON.stringify(exampleAiRoomLayout()), annotations: [] },
          ],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        total_tokens: 300,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  });
  const photo = { id: crypto.randomUUID(), name: "Room", key: "room.png", kind: "room" as const };
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRe8AAAAASUVORK5CYII=",
    "base64",
  );
  const result = await runAiRoomLayout({
    photos: [photo],
    loadPhoto: async () => image,
    progress: async () => {},
    signal: AbortSignal.timeout(10_000),
  });
  expect(requests).toBe(2);
  expect(result.scene.kind).toBe("ai-layout");
  expect(requestBody?.store).toBe(false);
  expect(JSON.stringify(requestBody)).toContain("data:image/png;base64,");
  expect(requestBody?.text).toMatchObject({ format: { type: "json_schema" } });
});
