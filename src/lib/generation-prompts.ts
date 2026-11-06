import type { z } from "zod";
import type { designInput, designModes, peopleOptions } from "./validation";
import type { RoomGuideConstraints } from "./room-guide";
import { scaleNotes } from "./scale";

export function buildEditPrompt(instruction: string) {
  return [
    "Task: Edit only the masked (transparent) region of the supplied design image.",
    `Requested change: ${instruction}`,
    "Preserve: Keep everything outside the mask exactly as it is — architecture, furniture, materials, colors, lighting, and camera. Retain the original crop, framing, perspective, and object positions. Do not globally restyle, relight, sharpen, or recolor the image.",
    "Integration: Match the surrounding perspective, grain, textures, and lighting so the edit blends seamlessly and photorealistically. Keep unrelated details inside the mask unchanged where the requested change allows.",
    "Output: Return only the edited image, without added text, labels, borders, or collage.",
  ].join("\n\n");
}

const outdoorRoomTypes = new Set(["Outdoor", "Garden", "Patio", "House exterior", "Balcony"]);
export const isOutdoor = (roomType: string) => outdoorRoomTypes.has(roomType);

const MODE_DIRECTIVES: Record<(typeof designModes)[number], string> = {
  redesign:
    "Image 1 is the exact camera view to redesign. Preserve its architecture, room dimensions, perspective, windows, doors, ceiling, permanent fixtures, and natural light. Do not invent space or move walls.",
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
const OUTDOOR_DIRECTIVES: Partial<Record<(typeof designModes)[number], string>> = {
  redesign:
    "Image 1 is the exact camera view to redesign. Preserve the property's fixed structure and layout: buildings, boundary walls, fencing, paving, pools, decks, permanent planters, and mature plantings. Do not move structures or change the property's boundaries.",
  stage:
    "The outdoor space is bare: stage it. Preserve fixed structures, boundaries, paving, and permanent plantings, and do not move structures. Furnish and landscape the space so it feels inviting and finished, using the referenced products where provided.",
  paint:
    "Repaint and refinish only: preserve the camera view, all furniture, plantings, and layout exactly as they are. Change only colors and finishes on fences, walls, decks, and paving, following the brief and style. Do not add, remove, or move anything else.",
  empty:
    "Empty the space: remove furniture, umbrellas, planters, decor, toys, and vehicles. Keep buildings, fixed structures, paving, lawns, and mature plantings exactly as they are. Return a clean, cleared version of the same space from the same camera view.",
  sketch:
    "Image 1 is a sketch, drawing, or 3D-software screenshot rather than a photograph. Turn it into a photorealistic outdoor scene: honor the layout, proportions, structures, and fixed elements it depicts, then render believable materials, natural light, soft shadows, and furnishings in the chosen style.",
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

export function buildPrompt(
  roomType: string,
  input: z.infer<typeof designInput>,
  references: { name: string; kind: string; notes?: string; url?: string; dimensions?: string }[],
  roomCount: number,
  plan?: string,
  guide?: RoomGuideConstraints,
) {
  const outdoor = isOutdoor(roomType);
  const roomName = roomType === "Other" ? "a room" : `a ${roomType.toLowerCase()}`;
  const photoLess = !guide && roomCount === 0;
  const directive = guide
    ? null
    : photoLess
      ? input.previousDesignId
        ? "The final image is the previous design; there is no separate architectural photo. Refine it in place using the client brief, keeping its camera, architecture, furniture identities, quantities, and layout unless the brief asks for a change."
        : MODE_DIRECTIVES.freestyle
      : ((outdoor ? OUTDOOR_DIRECTIVES[input.mode] : undefined) ?? MODE_DIRECTIVES[input.mode]);
  const referenceList = references
    .map(
      (r, i) =>
        `Image ${roomCount + i + 1}: ${r.kind}, ${r.name}. ${r.notes || ""} ${r.dimensions ? `Client-confirmed physical size: ${r.dimensions}.` : ""} ${r.url ? `Source label: ${r.url} (do not assume you can browse it).` : ""}`,
    )
    .join("\n");
  const scales = scaleNotes(references, input.measurements);
  const scene = [
    input.people !== "none"
      ? `Naturally include ${PEOPLE_PHRASES[input.people]} in the scene at plausible scale, relaxed and candid.`
      : "",
    input.lighting !== "natural"
      ? `Lighting direction: ${input.lighting}. This explicit lighting choice overrides source-light preservation only; retain the camera, architecture, object positions, and material identities.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const parts = [
    `Task: You are an expert ${outdoor ? "landscape" : "interior"} designer producing a photorealistic visualization of ${roomName}.`,
    "Preserve and change:",
    guide
      ? `Image 1 is the client's chosen 3D camera/layout guide, a clean render of an AI-estimated room. Keep this exact viewpoint, framing, left/right orientation, footprint, openings, and fixed elements. Preserve the cutaway or overhead composition if shown; do not switch to a source photo's camera. Treat this as rendering over image 1, not composing a new room photograph: keep the camera elevation, azimuth, roll, field of view, perspective convergence, room silhouette, and amount of surrounding background. Do not zoom into the room, lower the camera to eye level, rotate to show the furniture front-on, or restore cutaway walls that hide the interior. Photorealism applies to materials and lighting, not a change in projection or composition. Apply the requested design task: ${input.mode === "empty" ? "remove movable furnishings, retain permanent fixtures" : input.mode === "stage" ? "furnish the empty room" : input.mode === "paint" ? "repaint and refinish only: keep all furniture, layout, and camera, change only colors and finishes" : "create a furnished photorealistic interior"}. The render's simplified colors, amber uncertainty tint, and transparency are diagram conventions, not finishes to reproduce.`
      : directive,
    scene ? `Scene direction:\n${scene}` : "",
    guide
      ? `Images 2 through ${roomCount} are original room photos in the saved layout's source-photo order (photoNumber 1 is image 2). Use them as appearance and evidence for materials, windows, doors, fixtures, and daylight, not as the output camera. Use each element's photoNumbers to find its supporting source images; the same object seen in multiple photos is one object, not several. The capture controls projection and placement; source photos supply appearance details for the corresponding elements. Do not move an element to its screen position in a different source camera. Where evidence conflicts with estimated geometry, retain photo-supported identity and appearance without changing the chosen camera, mirroring the room, or inventing observed space.`
      : roomCount > 1
        ? `Additional room images (images 2 through ${roomCount}) show the same room from other angles and are architectural context only.`
        : "",
    input.measurements
      ? `Client-supplied room measurements: ${input.measurements}. These are the physical scale authority for the scene.`
      : "",
    plan
      ? `Estimated placement guidance from a prior vision analysis of image 1: ${plan}\nTreat this plan as fallible guidance. Visible source architecture and client-confirmed measurements take precedence over estimates; explicit client placement requests take precedence over suggested placements. Do not alter architecture to satisfy the plan.`
      : "",
    guide
      ? `Saved architectural constraints (AI estimates, NOT measurements): ${JSON.stringify(guide.layout)}. All proportions, positions, and sizes in this layout are estimated, including elements marked visible; visible means photo-supported presence only. Inferred elements and assumptions remain uncertain. Client-supplied measurements override estimated scale. The stored layout uses plan coordinates (+x right facing +z); the render reflects x once into y-up Three.js coordinates and negates fixture yaw. Do not mirror the rendered view. Captured camera in scene coordinates and visibility settings: ${JSON.stringify(guide.capture)}. Hidden inferred structure or fixtures are omitted only from the render, not evidence of absence. Do not fill hidden regions as if observed. This is a separate visualization; it does not update the reconstruction or guarantee exact adherence.`
      : "",
    references.length && input.mode !== "empty"
      ? `Later images are furniture/product or style references, in this order:\n${referenceList}\nProduct references specify the exact furniture identity: preserve silhouette, proportions, arm/back shape, leg/base design, upholstery or wood finish, color, and distinctive details. Do not substitute a similar item or restyle the product to match the room. Inspiration references supply palette, mood, and styling only; do not copy their room geometry or introduce their furniture as additional requested products. A product photo is an object reference, not its background or camera. Use one instance of each requested product unless the brief specifies a different quantity; do not duplicate the same item from multiple references. Respect physical width, depth, and height together; perspective may change apparent pixel size but not physical proportions. Keep realistic contact shadows and unobstructed circulation.`
      : "",
    scales.length ? `Physical scale guidance:\n${scales.map((s) => `- ${s}`).join("\n")}` : "",
    input.mode !== "empty"
      ? "Furniture placement rules: follow explicit locations, orientations, and quantities in the client brief. For furniture retained in the design, preserve its supported location, orientation, and relationships to walls, windows, and neighboring objects; do not rearrange it merely for a more attractive composition. A replacement occupies the replaced item's location and orientation unless the brief asks to move it. Add new pieces only in available floor space, keeping doors, passages, and drawers usable. Never shrink, stretch, crop away, or push furniture through walls to force a fit. If the requested size cannot plausibly fit, preserve product proportions and clearances rather than pretending it fits. With no specified placement, choose a conservative arrangement consistent with the captured layout when present."
      : "Furniture and product references do not authorize adding movable objects in empty mode. Remove movable furniture even when it appears as a box in the captured layout; retain built-ins and permanent fixtures.",
    `Client-confirmed physical sizes override size labels in source titles or variant notes. Image pixel dimensions are not physical measurements. If physical sizes or room measurements are missing, estimate conservatively and do not assume exact fit.`,
    `Style direction: ${input.style}. Apply style only to changes allowed by the selected task; it does not authorize altering preserved geometry, products, or furniture.\nClient brief: ${input.notes || (input.mode === "empty" ? "Remove movable furnishings and retain existing finishes and permanent fixtures." : input.mode === "paint" ? "Update surface colors and finishes while retaining all furniture and decor." : `Create a cohesive, comfortable, thoughtfully furnished ${outdoor ? "outdoor space" : "interior"}.`)}`,
    guide && input.mode !== "empty"
      ? "Captured furniture boxes are placement and approximate volume guides, not the final product shape or finish. Match a requested product to an existing box only when the brief or evidence identifies it as the replacement; do not turn every fixture box into a copy of a reference product. Client-confirmed product dimensions override estimated box sizes, while retaining the intended anchor and orientation if physically plausible. showFixtures=false hides boxes for inspection; it is not an instruction to delete permanent fixtures or proof that the room is empty."
      : "",
    input.mode === "empty"
      ? "Before returning, verify that movable furniture is absent and permanent architecture and fixtures remain intact."
      : "Before returning, visually check each requested product against its reference image and dimensions: identity, silhouette, color/material, proportions, quantity, location, orientation, floor contact, collisions, and door/walkway clearance. Correct mismatches before returning. Verify that styling and lighting have not changed product identity, and that no furniture was duplicated from source photos or inspiration images.",
    guide
      ? "Final camera check: compare the room outline, visible wall edges, opening positions, and fixture anchors to image 1 in normalized image coordinates. Preserve their screen-space arrangement, occlusion order, and framing. Output one photorealistic architectural visualization from the captured camera, retaining an exterior elevated, cutaway, or top-down view whenever image 1 shows one. Do not return an eye-level interior photograph in place of the captured view. No text, labels, collage, borders, or before/after split."
      : input.mode === "empty"
        ? "Return only a polished photograph of the emptied room, without text, labels, collage, borders, or a before/after split."
        : outdoor
          ? "Return only a polished photograph of the space, without text, labels, collage, borders, or a before/after split."
          : "Return only a polished interior photograph, without text, labels, collage, borders, or a before/after split.",
    "This is a design visualization, not a measurement or guarantee of fit.",
  ];
  return parts.filter(Boolean).join("\n\n");
}
