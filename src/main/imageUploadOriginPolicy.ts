// File windows can omit Origin on XHR. Attest only the bundled top frame's
// authenticated upload request; never attach credentials or authorize a URL.
export function needsImageUploadOrigin(request: { url: string; method: string; origin?: string },
  backendUrl: string, frameUrl: string, rendererUrl: string, trustedTopFrame: boolean): boolean {
  if (!trustedTopFrame || frameUrl !== rendererUrl || !rendererUrl.startsWith("file://") ||
    !["POST", "OPTIONS"].includes(request.method) || (request.origin !== undefined && request.origin !== "null")) return false;
  try {
    const backend = new URL(backendUrl), target = new URL(request.url);
    return backend.protocol === "ws:" && backend.hostname === "127.0.0.1" &&
      target.protocol === "http:" && target.host === backend.host && target.pathname === "/images/upload" &&
      !target.username && !target.password && !!backend.searchParams.get("token") &&
      target.searchParams.getAll("token").length === 1 && target.searchParams.get("token") === backend.searchParams.get("token");
  } catch { return false; }
}
