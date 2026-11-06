import { ENV } from "varlock/env";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import type { designModes } from "./validation";

export type LayoutPlan = {
  roomEstimate?: string;
  placements: { name: string; position?: string; widthRatio?: number; notes?: string }[];
  cautions?: string;
};

const placementSchema = z.object({
  name: z.string().max(120).optional().catch(undefined),
  position: z.string().max(400).optional().catch(undefined),
  widthRatio: z.coerce.number().min(0).max(1).optional().catch(undefined),
  notes: z.string().max(400).optional().catch(undefined),
});
const planSchema = z.object({
  roomEstimate: z.string().max(500).optional().catch(undefined),
  placements: z.array(placementSchema).max(16).catch([]),
  cautions: z.string().max(500).optional().catch(undefined),
});

/** Extracts the plan JSON from a model reply, tolerating prose or markdown fences. */
export function parsePlan(text: string): LayoutPlan | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = planSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) return null;
    const placements = parsed.data.placements
      .map((p) => ({ ...p, name: p.name || "Item" }))
      .filter((p) => p.position || p.notes || p.widthRatio !== undefined);
    return { roomEstimate: parsed.data.roomEstimate, placements, cautions: parsed.data.cautions };
  } catch {
    return null;
  }
}

export function formatPlan(plan: LayoutPlan): string {
  const lines: string[] = [];
  if (plan.roomEstimate) lines.push(`Estimated room geometry: ${plan.roomEstimate}.`);
  for (const p of plan.placements) {
    const ratio =
      p.widthRatio !== undefined
        ? ` (spans about ${Math.round(p.widthRatio * 100)}% of that wall's width)`
        : "";
    lines.push(
      `- ${p.name}: ${p.position || "placement flexible"}${ratio}${p.notes ? ` — ${p.notes}` : ""}`,
    );
  }
  if (plan.cautions) lines.push(`Watch out: ${plan.cautions}`);
  return lines.join(" ");
}

export async function analyzeLayout(args: {
  mode: (typeof designModes)[number];
  baseImage: Uint8Array;
  mediaType?: string;
  roomType: string;
  references: { name: string; kind: string; dimensions?: string }[];
  measurements?: string;
  style: string;
  brief: string;
}): Promise<string | null> {
  try {
    if (!ENV.OPENAI_API_KEY) return null;
    const provider = createOpenAI({ apiKey: ENV.OPENAI_API_KEY });
    const inventory = args.references.length
      ? `Products to place (physical sizes included where known):\n${args.references
          .map((r) => `- ${r.name} (${r.kind}${r.dimensions ? `, size ${r.dimensions}` : ""})`)
          .join("\n")}`
      : "No specific products to place.";
    const task =
      args.mode === "empty"
        ? `The goal is to produce an emptied version of this room. Leave "placements" as an empty array, and use "cautions" to list anything that must survive emptying (built-ins, radiators, fixed shelving).`
        : `For each product listed, plan its placement: where it goes relative to the photo's viewpoint, and the fraction (0-1) of that wall's width it should span given its physical size${args.measurements ? ` and the client measurements: ${args.measurements}` : ""}.`;
    const reply = await generateText({
      model: provider.chat(ENV.OPENAI_LAYOUT_MODEL || "gpt-6-luna"),
      system:
        "You estimate room geometry from photos and plan furniture placement at true scale. Reply with only a JSON object, no markdown fences.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `This photo shows a ${args.roomType}. First estimate the room's geometry (wall widths, ceiling height) from visible cues such as doors, windows, radiators or furniture, briefly noting your basis. ${task} Style direction: ${args.style}. Client brief: ${args.brief || "none"}. ${inventory}\nReply with JSON exactly shaped as: {"roomEstimate": string, "placements": [{"name": string, "position": string, "widthRatio": number, "notes": string}], "cautions": string}.`,
            },
            { type: "file", data: args.baseImage, mediaType: args.mediaType || "image" },
          ],
        },
      ],
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(90_000),
    });
    const plan = parsePlan(reply.text);
    if (!plan || (!plan.placements.length && !plan.roomEstimate && !plan.cautions)) return null;
    return formatPlan(plan);
  } catch {
    return null;
  }
}
