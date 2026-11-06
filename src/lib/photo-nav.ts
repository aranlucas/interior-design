import type { Asset } from "./types";

export function stepPhoto(photos: Asset[], currentId: string, step: 1 | -1): Asset | undefined {
  if (photos.length < 2) return undefined;
  const index = photos.findIndex((a) => a.id === currentId);
  if (index < 0) return step === 1 ? photos[0] : photos[photos.length - 1];
  const next = index + step;
  if (next < 0 || next >= photos.length) return undefined;
  return photos[next];
}
