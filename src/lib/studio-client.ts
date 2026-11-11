import type { User } from "./types";
import { designModes, peopleOptions, lightingOptions, orientations } from "./validation";
export type Session = {
  user: User | null;
  local: boolean;
  authConfigured: boolean;
  generationConfigured: boolean;
  imageModel: string;
};
export const studioUrls = {
  session: "/api/session",
  rooms: "/api/rooms",
  generation: "/api/generate",
  editDesign: "/api/designs/edit",
  designPreview: "/api/designs/preview",
  importReference: "/api/import",
} as const;
export type View = "photo" | "room" | "design" | "compare";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    const text = await r.text();
    try {
      throw new Error(JSON.parse(text).error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }
  return r.json();
}
export const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const styleGroups = [
  {
    group: "Popular",
    items: [
      "Warm minimalism",
      "Scandinavian",
      "Japandi",
      "Mid-century modern",
      "Organic modern",
      "Minimalist",
      "Modern",
    ],
  },
  {
    group: "Classic",
    items: [
      "French country",
      "Parisian",
      "Traditional",
      "Rustic",
      "Farmhouse",
      "Mediterranean",
      "Art Deco",
      "Industrial",
      "Vintage",
      "Coastal",
    ],
  },
  {
    group: "Bold",
    items: ["Bohemian", "Maximalist", "Eclectic", "Retro", "Luxury", "Futuristic", "Cyberpunk"],
  },
  { group: "Nature", items: ["Zen", "Tropical", "Biophilic", "Bali"] },
] as const;
export const styles = styleGroups.flatMap((g) => g.items);
export const roomTypes = [
  "Living room",
  "Bedroom",
  "Dining room",
  "Kitchen",
  "Home office",
  "Bathroom",
  "Kids room",
  "Hallway",
  "Laundry room",
  "Closet",
  "Gym",
  "Attic",
  "Garden",
  "Patio",
  "House exterior",
  "Balcony",
  "Other",
];
export type Mode = (typeof designModes)[number];
export type People = (typeof peopleOptions)[number];
export type Lighting = (typeof lightingOptions)[number];
export type Orientation = (typeof orientations)[number];
export const modes: { id: Mode; label: string; hint: string }[] = [
  {
    id: "redesign",
    label: "Redesign",
    hint: "Keep the room's architecture; restyle and refurnish it.",
  },
  { id: "stage", label: "Stage", hint: "Fill an empty or bare room using your references." },
  {
    id: "paint",
    label: "Paint",
    hint: "Keep furniture and layout; change colors, finishes, and surfaces only.",
  },
  { id: "empty", label: "Empty", hint: "Remove all furniture and decor, keep the architecture." },
  {
    id: "sketch",
    label: "Sketch",
    hint: "Render a sketch or 3D screenshot into a photorealistic room.",
  },
  {
    id: "freestyle",
    label: "Freestyle",
    hint: "Compose a room from the type, style, and brief alone — no photo needed.",
  },
];
const capitalize = (value: string) => value[0].toUpperCase() + value.slice(1);
export const peopleChoices = peopleOptions.map((id) => ({ id, label: capitalize(id) }));
export const lightingChoices = lightingOptions.map((id) => ({ id, label: capitalize(id) }));
export const orientationChoices: { id: Orientation; label: string }[] = [
  { id: "landscape", label: "Landscape" },
  { id: "portrait", label: "Portrait" },
  { id: "square", label: "Square" },
];
export const accept = "image/jpeg,image/png,image/webp";

export async function compress(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 25_000_000) throw new Error("Choose a photo smaller than 25 MB.");
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not prepare photo."))),
      "image/jpeg",
      0.88,
    ),
  );
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpeg", { type: "image/jpeg" });
}

/** Downscale a design to a filmstrip preview. JPEG, since WebP encoding is not universal. */
export async function makePreview(source: Blob, edge = 640) {
  const image = await createImageBitmap(source);
  try {
    const scale = Math.min(1, edge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not prepare preview."))),
        "image/jpeg",
        0.82,
      ),
    );
  } finally {
    image.close();
  }
}
