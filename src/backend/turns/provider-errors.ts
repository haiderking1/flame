import { CHATGPT_USAGE_URL } from "../../contracts/usage.js";
import { InferenceFailure } from "./sse.js";

export class ContextOverflow extends InferenceFailure {}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const NOT_REPLAYED = "The request was not replayed.";
export function isContextOverflow(value: unknown): boolean {
  const error = record(value);
  return ["context_length_exceeded", "context_window_exceeded", "max_context_length_exceeded"].includes(String(error.code))
    || ["context_length_exceeded", "context_window_exceeded"].includes(String(error.type));
}
// Sign in with ChatGPT's errors: https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
const PLAN_ERRORS: Record<string, (param: string | null) => string> = {
  subscription_sharing_usage_limit_exceeded: () => `You reached the limit of your ChatGPT plan that Flame can use. Check it in ChatGPT under Settings → Usage (${CHATGPT_USAGE_URL}). ${NOT_REPLAYED}`,
  subscription_sharing_usage_unavailable: () => `ChatGPT plan usage is unavailable right now. Try again in a moment. ${NOT_REPLAYED}`,
  subscription_sharing_user_unavailable: () => `ChatGPT plan usage is unavailable right now. Try again in a moment. ${NOT_REPLAYED}`,
  subscription_sharing_user_not_eligible: () => `Your ChatGPT plan cannot be used in other apps. Use the legacy Codex sign-in in Providers instead. ${NOT_REPLAYED}`,
  subscription_sharing_unsupported_capability: param => `Sign in with ChatGPT does not support ${param ? `"${param}"` : "something this request uses"}. Choose another model. ${NOT_REPLAYED}`,
  subscription_sharing_route_not_supported: () => `Sign in with ChatGPT does not support this request. ${NOT_REPLAYED}`,
  subscription_sharing_invalid_user: () => `OpenAI no longer accepts this sign-in. Sign in again in Providers. ${NOT_REPLAYED}`,
  chatpass_v2_scope_not_authorized: () => `Flame is not allowed to use your ChatGPT plan. Sign in again in Providers and allow it. ${NOT_REPLAYED}`,
};
/** What to tell the user about a ChatGPT plan error; null for any other error. */
export function planFailureMessage(value: unknown): string | null {
  const error = record(value), code = typeof error.code === "string" ? error.code : null;
  const message = code ? PLAN_ERRORS[code] : undefined;
  return message ? message(typeof error.param === "string" && error.param.length <= 128 ? error.param : null) : null;
}
export function providerFailure(value: unknown): InferenceFailure {
  if (isContextOverflow(value)) return new ContextOverflow("OpenAI's context window is full.");
  return new InferenceFailure(planFailureMessage(value) ?? `OpenAI did not complete this response. ${NOT_REPLAYED}`);
}
/** The error a rejected request's body describes: its `error` object, or an admission error's `detail`. */
export async function readProviderError(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 16 * 1024) return undefined;
      chunks.push(chunk.value);
    }
    const body = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return body.error ?? (typeof body.detail === "string" ? { detail: body.detail } : undefined);
  } catch { return undefined; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
