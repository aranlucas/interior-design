export function exportEditMask(
  painted: HTMLCanvasElement,
  source: { width: number; height: number },
): Promise<Blob> {
  const mask = document.createElement("canvas");
  mask.width = source.width;
  mask.height = source.height;
  mask.getContext("2d")!.drawImage(painted, 0, 0, mask.width, mask.height);
  return new Promise((resolve, reject) =>
    mask.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not prepare the mask."))),
      "image/png",
    ),
  );
}
