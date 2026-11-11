import type { z } from "zod";
import type { designInput, designModes, peopleOptions } from "./validation";
import type { RoomGuideConstraints } from "./room-guide";
import { scaleNotes } from "./scale";
import { describeGuide, guideView } from "./guide-projection";

const NO_TEXT = "No text, labels, watermarks, collage, borders, or before/after split.";

export function buildEditPrompt(
  instruction: string,
  references: { name: string; kind: string; dimensions?: string }[] = [],
) {
  return [
    "Task: Edit only the masked (transparent) region of image 1, the supplied design image.",
    `Requested change: ${instruction}`,
    references.length
      ? `Reference images:\n${references
          .map(
            (r, i) =>
              `- Image ${i + 2}: ${r.kind}, ${r.name}.${r.dimensions ? ` Client-confirmed physical size: ${r.dimensions}.` : ""}`,
          )
          .join(
            "\n",
          )}\nA product reference shows the exact item to place inside the mask: keep its silhouette, proportions, materials, and color. Its background and camera are not part of the scene. Inspiration references set palette and styling only.`
      : "",
    "Preserve: Keep everything outside the mask exactly as it is — architecture, furniture, materials, colors, lighting, and camera. Retain the original crop, framing, perspective, and object positions. Do not globally restyle, relight, sharpen, or recolor the image.",
    "Integration: Match the surrounding perspective, grain, textures, and lighting so the edit blends seamlessly and photorealistically. Keep unrelated details inside the mask unchanged where the requested change allows.",
    `Output: Return only the edited image. ${NO_TEXT}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildFinalPrompt() {
  return [
    "Task: Image 1 is an approved interior design visualization. Re-render it as the final, maximum-detail photograph.",
    "Keep: the exact composition, crop, camera, perspective, architecture, every object and its position, quantities, materials, colors, and lighting.",
    "Change: only photorealism — sharper fine detail, natural texture in fabrics, wood, stone, and metal, clean straight lines, and believable light falloff and contact shadows. Do not add, remove, move, resize, or restyle anything.",
    `Output: one polished photograph. ${NO_TEXT}`,
  ].join("\n\n");
}

const outdoorRoomTypes = new Set(["Outdoor", "Garden", "Patio", "House exterior", "Balcony"]);
export const isOutdoor = (roomType: string) => outdoorRoomTypes.has(roomType);

type Mode = (typeof designModes)[number];
const MODE_DIRECTIVES: Record<Mode, string> = {
  redesign:
    "Redesign the room shown in image 1 from its exact camera view. Preserve its architecture, room dimensions, perspective, windows, doors, ceiling, permanent fixtures, and natural light. Do not invent space or move walls.",
  stage:
    "The room is empty or nearly empty: virtually stage it. Preserve its architecture, room dimensions, perspective, windows, doors, ceiling, permanent fixtures, and natural light, and do not invent space or move walls. Furnish and decorate the space so it feels lived-in and appealing, using the referenced products where provided.",
  paint:
    "Repaint and refinish only: preserve the camera view, all furniture, decor, layout, room dimensions, perspective, windows, doors, and natural light exactly as they are. Change only colors and finishes — wall and ceiling paint, floor finish, trim, tile, and other surface materials — following the brief and style. Do not add, remove, move, or restyle any furniture or decor.",
  empty:
    "Empty the space: remove all furniture, rugs, decor, wall art, and personal items. Keep the architecture, floor and wall finishes, windows, doors, ceiling, built-in and permanent fixtures, and natural light exactly as they are. Return a clean, unfurnished version of the same room from the same camera view.",
  sketch:
    "Image 1 is a sketch, drawing, or 3D-software screenshot rather than a photograph. Turn it into a photorealistic interior: honor the layout, proportions, openings, and fixed elements it depicts, then render believable materials, natural light, soft shadows, and furnishings in the chosen style.",
  freestyle:
    "There is no input photo: compose the space from scratch as a photorealistic eye-level photograph. Invent plausible architecture appropriate to the space — walls, windows, doors, ceiling, and proportions for interiors; boundaries, structures, and plantings for outdoor spaces. Keep the invented architecture coherent and unremarkable so the style, furnishings, and brief stay the focus.",
};
const OUTDOOR_DIRECTIVES: Partial<Record<Mode, string>> = {
  redesign:
    "Redesign the outdoor space shown in image 1 from its exact camera view. Preserve the property's fixed structure and layout: buildings, boundary walls, fencing, paving, pools, decks, permanent planters, and mature plantings. Do not move structures or change the property's boundaries.",
  stage:
    "The outdoor space is bare: stage it. Preserve fixed structures, boundaries, paving, and permanent plantings, and do not move structures. Furnish and landscape the space so it feels inviting and finished, using the referenced products where provided.",
  paint:
    "Repaint and refinish only: preserve the camera view, all furniture, plantings, and layout exactly as they are. Change only colors and finishes on fences, walls, decks, and paving, following the brief and style. Do not add, remove, or move anything else.",
  empty:
    "Empty the space: remove furniture, umbrellas, planters, decor, toys, and vehicles. Keep buildings, fixed structures, paving, lawns, and mature plantings exactly as they are. Return a clean, cleared version of the same space from the same camera view.",
  sketch:
    "Image 1 is a sketch, drawing, or 3D-software screenshot rather than a photograph. Turn it into a photorealistic outdoor scene: honor the layout, proportions, structures, and fixed elements it depicts, then render believable materials, natural light, soft shadows, and furnishings in the chosen style.",
};
const GUIDE_TASKS: Record<Mode, string> = {
  redesign: "Create a furnished photorealistic interior.",
  stage: "Furnish the empty room.",
  paint:
    "Repaint and refinish only: keep all furniture, layout, and camera; change only colors and finishes.",
  empty: "Remove movable furnishings, retain permanent fixtures.",
  sketch: "Create a furnished photorealistic interior.",
  freestyle: "Create a furnished photorealistic interior.",
};
const PEOPLE_PHRASES: Record<(typeof peopleOptions)[number], string> = {
  none: "",
  man: "a man",
  woman: "a woman",
  couple: "a couple",
  family: "a family",
  friends: "a small group of friends",
  dog: "a dog",
  cat: "a cat",
};

type Reference = {
  id?: string;
  name: string;
  kind: string;
  notes?: string;
  url?: string;
  dimensions?: string;
};
const section = (title: string, lines: (string | false | undefined)[]) => {
  const body = lines.filter(Boolean).join("\n");
  return body ? `${title}:\n${body}` : "";
};
const range = (from: number, to: number) =>
  from === to ? `Image ${from}` : `Images ${from}–${to}`;

export function buildPrompt(
  roomType: string,
  input: z.infer<typeof designInput>,
  references: Reference[],
  roomCount: number,
  plan?: string,
  guide?: RoomGuideConstraints,
) {
  const outdoor = isOutdoor(roomType);
  const mode = input.mode;
  const roomName = roomType === "Other" ? "a room" : `a ${roomType.toLowerCase()}`;
  const photoLess = !guide && roomCount === 0;
  const refs = mode === "empty" ? [] : references;
  const firstRef = roomCount + 1;
  const previousImage = input.previousDesignId ? roomCount + refs.length + 1 : undefined;
  const view = guide ? guideView(guide.layout, guide.capture) : undefined;
  const products = refs.some((r) => r.kind === "product") && mode !== "paint";

  const images: string[] = [];
  if (guide && view) {
    images.push(
      view.interior
        ? `- Image 1: the client's chosen camera — an eye-level view inside a simplified 3D model of the room (AI-estimated geometry). This is the output camera.`
        : `- Image 1: the client's chosen camera — an elevated ${view.pitch < -60 ? "top-down" : "cutaway"} view of a simplified 3D model of the room (AI-estimated geometry). This is the output camera.`,
    );
    if (roomCount > 1)
      images.push(
        `- ${range(2, roomCount)}: the original room photos in the layout's evidence order (photo 1 is image 2). Use them for appearance — materials, windows, doors, fixtures, daylight — not as the output camera. An object seen in several photos is one object, not several.`,
      );
  } else if (!photoLess) {
    images.push(
      mode === "sketch"
        ? "- Image 1: the sketch, drawing, or 3D screenshot to render. This is the output camera."
        : "- Image 1: the room photo to work from. This is the output camera and the architectural authority.",
    );
    if (roomCount > 1)
      images.push(
        `- ${range(2, roomCount)}: the same room from other angles, for architectural context only.`,
      );
  }
  refs.forEach((r, i) => {
    const role =
      mode === "paint"
        ? "a color, material, or style swatch only"
        : r.kind === "product"
          ? "the exact product to include"
          : "palette, mood, and styling only";
    images.push(
      `- Image ${firstRef + i}: ${r.kind}, ${r.name}. Role: ${role}.${r.notes ? ` Notes: ${r.notes}.` : ""}${r.dimensions ? ` Client-confirmed physical size: ${r.dimensions}.` : ""}${r.url ? ` Source label: ${r.url} (do not assume you can browse it).` : ""}`,
    );
  });
  if (previousImage)
    images.push(`- Image ${previousImage}: the previous design, to refine rather than replace.`);

  const directive = guide
    ? `${GUIDE_TASKS[mode]} Render image 1 as a real ${view?.interior ? "interior photograph" : "architectural visualization"} from exactly its camera: same position, height, direction, field of view, framing, left/right orientation, and the same placement of walls, openings, and furniture in the frame.${view?.interior ? "" : " Keep the elevated or cutaway composition, the room silhouette, and the amount of surrounding background: do not zoom in, lower the camera to eye level, rotate to show furniture front-on, or restore walls cut away to show the interior."} Photorealism applies to materials and lighting, not to a change in projection or composition. The render's flat colors, amber tint on inferred surfaces, translucency, and colored product boxes are diagram conventions, not finishes to reproduce.`
    : photoLess
      ? previousImage
        ? `There is no architectural photo: refine image ${previousImage} in place using the client brief, keeping its camera, architecture, furniture identities, quantities, and layout unless the brief asks for a change.`
        : MODE_DIRECTIVES.freestyle
      : ((outdoor ? OUTDOOR_DIRECTIVES[mode] : undefined) ?? MODE_DIRECTIVES[mode]);
  const brief =
    input.notes ||
    (mode === "empty"
      ? "Remove movable furnishings and retain existing finishes and permanent fixtures."
      : mode === "paint"
        ? "Update surface colors and finishes while retaining all furniture and decor."
        : `Create a cohesive, comfortable, thoughtfully furnished ${outdoor ? "outdoor space" : "interior"}.`);
  const previous =
    previousImage !== undefined &&
    !photoLess &&
    (guide
      ? `Image ${previousImage} is the previous design. Preserve its furniture identities, quantities, materials, physical proportions, and relative placement unless the brief explicitly requests a change, carried into image 1's camera rather than copied from its screen positions.${mode === "empty" ? " In empty mode, remove movable furnishings regardless of the previous design." : ""}`
      : `Image ${previousImage} is the previous design. Make only the changes requested in the brief, preserving its furniture identities, quantities, materials, and placement unless the selected task requires otherwise. Image 1 remains the camera and architecture authority: keep its crop, viewpoint, and perspective.`);

  const scales = scaleNotes(refs, input.measurements);
  const parts = [
    `Task: You are an expert ${outdoor ? "landscape" : "interior"} designer producing one photorealistic visualization of ${roomName}.`,
    section("Images", images),
    section("Change", [
      directive,
      `Style direction: ${input.style}. Apply style only to changes allowed by the selected task; it does not authorize altering preserved geometry, products, or furniture.`,
      `Client brief: ${brief}`,
      input.people !== "none" &&
        `Naturally include ${PEOPLE_PHRASES[input.people]} at plausible scale, relaxed and candid.`,
      input.lighting !== "natural" &&
        `Lighting direction: ${input.lighting}. This overrides source-light preservation only; keep the camera, architecture, object positions, and material identities.`,
      previous,
      input.fillGaps &&
        "This is an optional AI finish of a partial photo reconstruction. Keep architecture and contents visible in the original photos consistent across views. Fill visual gaps conservatively without claiming inferred areas were observed or measured.",
    ]),
    guide &&
      section(
        "3D guide (AI estimates; positions are normalized image 1 coordinates, x left→right, y top→bottom)",
        [
          describeGuide(
            guide.layout,
            guide.capture,
            (assetId) => {
              const index = refs.findIndex((r) => r.id === assetId);
              return index < 0 ? undefined : firstRef + index;
            },
            mode !== "empty" && mode !== "paint",
          ),
          "Visible means photo-supported presence only; every size and position is estimated. Where a source photo conflicts with the estimate, keep the photo's identity and appearance without changing the camera, mirroring the room, or inventing observed space. Hidden inferred structure is omitted only from the render; it is not evidence of absence, and hidden regions must not be filled as if observed.",
        ],
      ),
    plan &&
      section("Estimated placement guidance (fallible)", [
        plan,
        "Visible source architecture and client-confirmed measurements take precedence over estimates; explicit client placement requests take precedence over suggested placements. Do not alter architecture to satisfy the plan.",
      ]),
    mode === "empty"
      ? section("Furniture", [
          "Remove movable furniture even when it appears as a box in a captured layout; retain built-ins and permanent fixtures.",
        ])
      : mode === "paint"
        ? section("References", [
            refs.length > 0 &&
              "References in paint mode are color, material, or style swatches only. Do not add, remove, replace, or move furniture or decor to match them.",
          ])
        : section("Products and placement", [
            products &&
              "A product reference specifies the exact item: preserve its silhouette, proportions, arm/back shape, leg/base design, upholstery or wood finish, color, and distinctive details. Do not substitute a similar item or restyle it to match the room. A product photo is an object reference, not its background or camera. Use one instance of each product unless the brief specifies a quantity; do not duplicate the same item from multiple references.",
            refs.some((r) => r.kind !== "product") &&
              "Inspiration references supply palette, mood, and styling only; do not copy their room geometry or add their furniture as extra products.",
            "Follow explicit locations, orientations, and quantities in the brief. Retained furniture keeps its location, orientation, and relationships to walls, windows, and neighbors; do not rearrange it for a prettier composition. A replacement occupies the replaced item's location and orientation unless the brief asks to move it. Add new pieces only in free floor space, keeping doors, walkways, and drawers usable. Never shrink, stretch, crop away, or push furniture through walls to make it fit; if a size cannot plausibly fit, keep true proportions and clearances.",
            guide &&
              "Furniture boxes in image 1 mark the position and rough volume of existing pieces, not their final shape or finish. Put a product into an existing box only when the brief, a placed product box, or the evidence identifies it as the replacement; do not turn every box into a copy of a product. Client-confirmed product dimensions override estimated box sizes. When fixtures are hidden in the render (showFixtures off), that is not an instruction to delete permanent fixtures or proof that the room is empty.",
          ]),
    section("Scale", [
      input.measurements &&
        `Client room measurements: ${input.measurements}. These are the physical scale authority.`,
      ...scales.map((s) => `- ${s}`),
      (refs.length > 0 || !!input.measurements) &&
        "Client-confirmed physical sizes override size labels in source titles or variant notes. Image pixel dimensions are not physical measurements. Where sizes are missing, estimate conservatively and do not assume an exact fit. Perspective may change apparent size but not physical proportions; keep realistic contact shadows.",
    ]),
    section("Output", [
      mode === "empty"
        ? "Before returning, check that movable furniture is gone and permanent architecture and fixtures are intact."
        : mode === "paint"
          ? "Before returning, check that every piece of furniture and decor is unchanged in identity and position."
          : products
            ? "Before returning, visually check each requested product against its reference image and size: identity, silhouette, color/material, proportions, quantity, location, orientation, floor contact, collisions, and door/walkway clearance. Fix mismatches. Check that no furniture was duplicated from source photos or inspiration images."
            : "",
      guide &&
        `Final camera check: the room outline, visible wall edges, openings, and furniture should sit where the 3D guide lists them in image 1, with the same occlusion order and framing.${view?.interior ? "" : " Return an exterior elevated, cutaway, or top-down view as image 1 shows. Do not return an eye-level interior photograph instead."}`,
      `Return one polished ${guide && !view?.interior ? "architectural visualization" : mode === "empty" ? "photograph of the emptied space" : outdoor ? "photograph of the space" : "interior photograph"}. ${NO_TEXT}`,
    ]),
  ];
  return parts.filter(Boolean).join("\n\n");
}
