export type Dimensions = { widthCm?: number; depthCm?: number; heightCm?: number };

const CM_PER_UNIT: Record<string, number> = {
  mm: 0.1,
  millimeter: 0.1,
  millimetre: 0.1,
  millimeters: 0.1,
  millimetres: 0.1,
  cm: 1,
  centimeter: 1,
  centimetre: 1,
  centimeters: 1,
  centimetres: 1,
  m: 100,
  meter: 100,
  metre: 100,
  meters: 100,
  metres: 100,
  in: 2.54,
  inch: 2.54,
  inches: 2.54,
  '"': 2.54,
  "”": 2.54,
  ft: 30.48,
  foot: 30.48,
  feet: 30.48,
  "'": 30.48,
  "’": 30.48,
};
const UNIT_GROUP = `(${Object.keys(CM_PER_UNIT)
  .sort((a, b) => b.length - a.length)
  .join("|")})?`;
// Numbers with optional fractions: "84", "84.5", "84 1/4", "1/2".
const NUM = String.raw`(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?|\d+\s*\/\s*\d+)`;
type Axis = keyof Dimensions;

function unitToCm(unit: string | undefined): number | undefined {
  if (!unit) return undefined;
  return CM_PER_UNIT[unit.toLowerCase().replace(/\./g, "").trim()];
}

function toNumber(text: string): number | undefined {
  const value = text.trim();
  const mixed = value.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const denominator = Number(mixed[3]);
    return denominator ? Number(mixed[1]) + Number(mixed[2]) / denominator : undefined;
  }
  const fraction = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator ? Number(fraction[1]) / denominator : undefined;
  }
  return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : undefined;
}

const AXIS_WORDS: [RegExp, Axis][] = [
  [/\b(?:width|bredd)s?\b/i, "widthCm"],
  [/\b(?:depth|djup|length|längd|langd)s?\b/i, "depthCm"],
  [/\b(?:height|höjd|hojd|ceiling|tak)s?\b/i, "heightCm"],
];
const AXIS_LETTERS: [string, Axis][] = [
  ["w", "widthCm"],
  ["d", "depthCm"],
  ["h", "heightCm"],
];
const AXIS_POSTFIX: [RegExp, Axis][] = [
  [/\bwide\b/i, "widthCm"],
  [/\bdeep\b/i, "depthCm"],
  [/\b(?:high|tall)\b/i, "heightCm"],
  [/\blong\b/i, "depthCm"],
];

function assign(target: Dimensions, axis: Axis, value: number) {
  if (target[axis] === undefined) target[axis] = Math.round(value * 10) / 10;
}

function labeledScan(text: string): Dimensions | undefined {
  const result: Dimensions = {};
  for (const [word, axis] of AXIS_WORDS) {
    const match = text.match(new RegExp(`${word.source}[^\\d]{0,8}${NUM}\\s*${UNIT_GROUP}`, "i"));
    const value = match ? toNumber(match[1]) : undefined;
    const cm = match ? unitToCm(match[2]) : undefined;
    if (value !== undefined && cm !== undefined) assign(result, axis, value * cm);
  }
  for (const [letter, axis] of AXIS_LETTERS) {
    const match = text.match(new RegExp(`\\b${letter}\\s*[:=]\\s*${NUM}\\s*${UNIT_GROUP}`, "i"));
    const value = match ? toNumber(match[1]) : undefined;
    const cm = match ? unitToCm(match[2]) : undefined;
    if (value !== undefined && cm !== undefined) assign(result, axis, value * cm);
  }
  for (const [word, axis] of AXIS_POSTFIX) {
    const match = text.match(new RegExp(`${NUM}\\s*${UNIT_GROUP}?\\s*${word.source}`));
    const value = match ? toNumber(match[1]) : undefined;
    const cm = match ? unitToCm(match[2]) : undefined;
    if (value !== undefined && cm !== undefined) assign(result, axis, value * cm);
  }
  return result.widthCm !== undefined ||
    result.depthCm !== undefined ||
    result.heightCm !== undefined
    ? result
    : undefined;
}

function positionalScan(text: string, fallbackCmPerUnit?: number): Dimensions | undefined {
  const separator = String.raw`\s*(?:[x×*]|by|,|;)\s*`;
  const match = text.match(
    new RegExp(
      `\\b${NUM}(?:\\s*${UNIT_GROUP})?${separator}${NUM}(?:\\s*${UNIT_GROUP})?(?:${separator}${NUM}(?:\\s*${UNIT_GROUP})?)?\\s*${UNIT_GROUP}?`,
      "i",
    ),
  );
  if (!match) return undefined;
  const result: Dimensions = {};
  const axes: Axis[] = ["widthCm", "depthCm", "heightCm"];
  const numbers = [match[1], match[3], match[5]];
  const units = [match[2], match[4], match[6]];
  // The unit is often stated once, after the last number: "211 × 88 × 83 cm".
  const shared =
    units.map(unitToCm).find((cm) => cm !== undefined) ?? unitToCm(match[7]) ?? fallbackCmPerUnit;
  let count = 0;
  for (let i = 0; i < 3; i++) {
    const value = numbers[i] ? toNumber(numbers[i]) : undefined;
    if (value === undefined) break;
    const cm = unitToCm(units[i]) ?? shared;
    if (cm === undefined) break;
    assign(result, axes[i], value * cm);
    count++;
  }
  return count >= 2 ? result : undefined;
}

function scan(text: string, fallbackCmPerUnit?: number): Dimensions | undefined {
  const labeled = labeledScan(text);
  const positional = positionalScan(text, fallbackCmPerUnit);
  if (!labeled) return positional;
  if (!positional) return labeled;
  return { ...positional, ...labeled };
}

/** Parses product dimension strings like "211 × 88 × 83 cm", "W:228cm D:98cm H:80cm" or `84 1/4"`. */
export function parseDimensions(text: string | undefined): Dimensions | undefined {
  if (!text?.trim()) return undefined;
  const result = scan(text);
  return result && (result.widthCm || result.depthCm || result.heightCm) ? result : undefined;
}

/** Parses room measurements like "4.2 × 3.6 m, ceiling 2.6 m" or "420 x 360 cm". */
export function parseRoomMeasurements(text: string | undefined): Dimensions | undefined {
  return parseDimensions(text);
}

function formatCm(value: number) {
  return `${Math.round(value)} cm`;
}

export function formatDimensions(dimensions: Dimensions): string {
  return [
    dimensions.widthCm !== undefined ? `${formatCm(dimensions.widthCm)} wide` : undefined,
    dimensions.depthCm !== undefined ? `${formatCm(dimensions.depthCm)} deep` : undefined,
    dimensions.heightCm !== undefined ? `${formatCm(dimensions.heightCm)} high` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" × ");
}

const DOOR_WIDTH_CM = 80;
const DOOR_HEIGHT_CM = 203;
const COUNTER_HEIGHT_CM = 90;

/**
 * Builds per-reference scale guidance. Image models judge size better against familiar objects
 * than against percentages, so sizes are related to standard doors and counters. When the room
 * is measured, the ratio is given against each measured side because the wall a piece will sit
 * against is unknown here.
 */
export function scaleNotes(
  references: { name: string; kind: string; dimensions?: string }[],
  roomMeasurements?: string,
): string[] {
  const room = parseRoomMeasurements(roomMeasurements);
  const sides = [room?.widthCm, room?.depthCm].filter((v): v is number => !!v);
  const notes: string[] = [];
  for (const reference of references) {
    if (!reference.dimensions?.trim()) continue;
    const name = reference.name || (reference.kind === "product" ? "Product" : "Reference");
    const parsed = parseDimensions(reference.dimensions);
    if (!parsed) {
      notes.push(`${name}: size ${reference.dimensions.trim()} (interpret conservatively).`);
      continue;
    }
    const anchors: string[] = [];
    const width = parsed.widthCm ?? parsed.depthCm;
    if (width !== undefined)
      anchors.push(
        `about ${(width / DOOR_WIDTH_CM).toFixed(1)} interior-door widths (~80 cm) across`,
      );
    if (parsed.heightCm !== undefined)
      anchors.push(
        parsed.heightCm < 120
          ? `about ${(parsed.heightCm / COUNTER_HEIGHT_CM).toFixed(1)}× kitchen-counter height (~90 cm)`
          : `about ${Math.round((parsed.heightCm / DOOR_HEIGHT_CM) * 100)}% of a standard door's height (~203 cm)`,
      );
    let note = `${name}: ${formatDimensions(parsed)}`;
    if (anchors.length) note += ` — ${anchors.join(", ")}`;
    if (width !== undefined && sides.length) {
      note += `; ${sides.map((side) => `${Math.round((width / side) * 100)}% of the room's ${formatCm(side)} side`).join(" or ")}`;
      if (width / Math.min(...sides) > 0.6)
        note += "; keep walkways clear and leave it breathing room";
    }
    notes.push(`${note}.`);
  }
  return notes;
}
