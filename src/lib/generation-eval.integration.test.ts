/**
 * Opt-in image-quality evaluation. Makes real, paid OpenAI calls; never runs in CI.
 *
 *   OPENAI_API_KEY=… ROOMFORM_EVAL_CASES=/abs/cases.json ROOMFORM_EVAL_OUT=/abs/out \
 *   ROOMFORM_EVAL_LABEL=$(git rev-parse --short HEAD) npx vitest run src/lib/generation-eval.integration.test.ts
 *
 * cases.json: [{ "name", "roomType", "mode", "notes", "style", "measurements"?, "photos": [abs paths,
 * base first], "references"?: [{ "path", "name", "kind": "product" | "inspiration", "dimensions"? }] }]
 *
 * Each run writes <out>/<label>/<case>.png, .prompt.txt and .score.json plus summary.json, so two
 * labels (e.g. before and after a prompt change) can be compared case by case.
 */
import { expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { generateImage, generateText, Output } from "ai";
import { buildPrompt } from "./generation-prompts";
import { designInput } from "./validation";
import { outputSize } from "./image-size";

const evalCase = z.object({
  name: z.string().regex(/^[\w-]+$/),
  roomType: z.string(),
  mode: designInput.shape.mode,
  notes: z.string().default(""),
  style: z.string().default("Modern"),
  measurements: z.string().default(""),
  photos: z.array(z.string()).min(1).max(4),
  references: z
    .array(
      z.object({
        path: z.string(),
        name: z.string(),
        kind: z.enum(["product", "inspiration"]),
        dimensions: z.string().optional(),
      }),
    )
    .default([]),
});
const score = z.object({
  architecturePreserved: z.number().int().min(1).max(5),
  cameraPreserved: z.number().int().min(1).max(5),
  productFidelity: z.number().int().min(1).max(5),
  noDuplicatedFurniture: z.number().int().min(1).max(5),
  briefFollowed: z.number().int().min(1).max(5),
  photorealism: z.number().int().min(1).max(5),
  problems: z.array(z.string()).max(8),
});

it.skipIf(!process.env.ROOMFORM_EVAL_CASES || !process.env.OPENAI_API_KEY)(
  "scores generated designs against their inputs",
  { timeout: 60 * 60_000 },
  async () => {
    const cases = z
      .array(evalCase)
      .parse(JSON.parse(await readFile(process.env.ROOMFORM_EVAL_CASES!, "utf8")));
    const out = join(
      process.env.ROOMFORM_EVAL_OUT || "eval-out",
      process.env.ROOMFORM_EVAL_LABEL || "run",
    );
    await mkdir(out, { recursive: true });
    const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const summary: Record<string, z.infer<typeof score>> = {};
    for (const c of cases) {
      const photos = await Promise.all(c.photos.map((p) => readFile(p)));
      const refs = await Promise.all(c.references.map((r) => readFile(r.path)));
      const input = designInput.parse({
        roomId: crypto.randomUUID(),
        baseId: crypto.randomUUID(),
        notes: c.notes,
        style: c.style,
        assetIds: [],
        mode: c.mode,
        measurements: c.measurements,
      });
      const prompt = buildPrompt(c.roomType, input, c.references, photos.length);
      const { image } = await generateImage({
        model: provider.image(process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.6-sunburst"),
        prompt: { text: prompt, images: [...photos, ...refs] },
        size: outputSize(photos[0]),
        providerOptions: {
          openai: { quality: process.env.ROOMFORM_EVAL_QUALITY || "medium", outputFormat: "png" },
        },
        maxRetries: 1,
      });
      const result = Buffer.from(image.base64, "base64");
      const { output } = await generateText({
        model: provider(process.env.ROOMFORM_EVAL_JUDGE_MODEL || "gpt-6.1-sol"),
        output: Output.object({ schema: score }),
        instructions:
          "You grade an AI interior visualization. Image 1 is the original room photo, then any other room photos, then reference images in order, and the LAST image is the generated result. Score 1 (fails) to 5 (excellent) for each criterion, judging only what is visible. List concrete problems.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Mode: ${c.mode}. Brief: ${c.notes || "none"}. References: ${c.references.map((r) => `${r.kind} ${r.name}`).join("; ") || "none"}.`,
              },
              ...[...photos, ...refs, result].map((data) => ({
                type: "file" as const,
                mediaType: "image",
                data,
              })),
            ],
          },
        ],
        providerOptions: { openai: { store: false } },
      });
      summary[c.name] = output;
      await writeFile(join(out, `${c.name}.png`), result);
      await writeFile(join(out, `${c.name}.prompt.txt`), prompt);
      await writeFile(join(out, `${c.name}.score.json`), JSON.stringify(output, null, 2));
    }
    const keys = Object.keys(score.shape).filter(
      (k) => k !== "problems",
    ) as (keyof (typeof summary)[string])[];
    const averages = Object.fromEntries(
      keys.map((k) => [
        k,
        Object.values(summary).reduce((sum, s) => sum + Number(s[k]), 0) / cases.length,
      ]),
    );
    await writeFile(
      join(out, "summary.json"),
      JSON.stringify({ averages, cases: summary }, null, 2),
    );
    expect(Object.keys(summary)).toHaveLength(cases.length);
  },
);
