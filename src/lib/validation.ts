import { imageSettings } from "./image-settings";
import { z } from "zod";
import { roomModelInput } from "./room-model";
import { roomGuideInput } from "./room-guide";
export const roomInput = z.object({
  name: z.string().trim().max(100).optional(),
  type: z.string().trim().min(1).max(60).default("Living room"),
});
export function roomName(type: string, taken: string[]) {
  let name = type;
  for (let n = 2; taken.includes(name); n++) name = `${type} ${n}`;
  return name;
}
export const designModes = ["redesign", "stage", "paint", "empty", "sketch", "freestyle"] as const;
export const peopleOptions = [
  "none",
  "man",
  "woman",
  "couple",
  "family",
  "friends",
  "dog",
  "cat",
] as const;
export const lightingOptions = [
  "natural",
  "daylight",
  "golden hour",
  "evening",
  "cozy lamps",
] as const;
export const orientations = ["landscape", "portrait", "square"] as const;
export const designInput = z.object({
  roomId: z.uuid(),
  baseId: z.uuid().optional(),
  notes: z.string().max(4000),
  style: z.string().max(100),
  assetIds: z.array(z.uuid()).max(10),
  previousDesignId: z.uuid().optional(),
  mode: z.enum(designModes).default("redesign"),
  count: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).default(1),
  orientation: z.enum(orientations).default("landscape"),
  measurements: z.string().trim().max(200).default(""),
  people: z.enum(peopleOptions).default("none"),
  lighting: z.enum(lightingOptions).default("natural"),
  fillGaps: z.boolean().optional(),
  roomGuide: roomGuideInput.optional(),
  imageSettings: imageSettings.optional(),
});
export const uuid = z.uuid();
export const editInput = z.object({
  roomId: uuid,
  designId: uuid,
  prompt: z.string().trim().min(1).max(1000),
});

export const roomUpdate = z.union([
  z.object({ roomId: uuid, model: roomModelInput }),
  z.object({ roomId: uuid, assetId: uuid, dimensions: z.string().trim().max(200) }),
  z.object({
    roomId: uuid,
    notes: z.string().max(4000),
    style: z.string().max(100),
    imageSettings: imageSettings.optional(),
  }),
  z.object({ roomId: uuid, name: z.string().trim().min(1).max(100) }),
  z.object({ roomId: uuid, designId: uuid, starred: z.boolean() }),
]);
export const roomDelete = z
  .object({
    roomId: uuid,
    assetId: uuid.optional(),
    designId: uuid.optional(),
  })
  .refine((value) => !(value.assetId && value.designId), "Choose one item to delete.");
