// Image payloads are accounted separately from text/tool history, not mistaken for text tokens.
export function fitsInputBudget(input: unknown): boolean {
  let imageBytes = 0;
  const text = JSON.stringify(input, function (key, value: unknown) {
    if (key === "image_url" && this?.type === "input_image" && typeof value === "string" && value.startsWith("data:image/")) {
      imageBytes += Buffer.byteLength(value); return "[image payload]";
    }
    return value;
  });
  return imageBytes <= 64 * 1024 * 1024 && Buffer.byteLength(text) <= 8 * 1024 * 1024;
}
