import { z } from "zod";

export const imageQuality = z.enum(["low", "medium", "high", "xhigh", "max", "auto"]);
export const imageSize = z.enum([
  "photo",
  "1536x1024",
  "2048x1152",
  "3840x2160",
  "2160x3840",
  "2048x2048",
]);
export const imageSettings = z.object({ quality: imageQuality, size: imageSize });
export type ImageSettings = z.infer<typeof imageSettings>;
export const defaultImageSettings: ImageSettings = { quality: "max", size: "3840x2160" };
export const defaultImageModel = "gpt-image-2.6-sunburst";

export const qualityOptions = [
  { value: "low", label: "Low · quick draft" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max · most detail" },
  { value: "auto", label: "Auto · model chooses" },
] as const;
export const sizeOptions = [
  { value: "photo", label: "Match photo · up to 4K" },
  { value: "1536x1024", label: "Standard · 1536 × 1024" },
  { value: "2048x1152", label: "2K landscape · 2048 × 1152" },
  { value: "3840x2160", label: "4K landscape · 3840 × 2160" },
  { value: "2160x3840", label: "4K portrait · 2160 × 3840" },
  { value: "2048x2048", label: "2K square · 2048 × 2048" },
] as const;

export function outputCost(model: string, tokens: number | undefined) {
  // Other configurable models can have different pricing. Never invent a cost.
  // Verified against the OpenAI image generation guide (2026-11-05).
  return /^gpt-image-2\.[56]-(sunburst|flare)(-|$)/.test(model) && tokens !== undefined
    ? (tokens * 30) / 1_000_000
    : undefined;
}
