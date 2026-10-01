import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

/** How Flame signed in to OpenAI: Sign in with ChatGPT, or the legacy Codex sign-in. */
export const AuthMethod = Schema.Literals(["chatgpt", "codex"]);
export type AuthMethod = typeof AuthMethod.Type;
export const CodexAccount = Schema.Struct({ email: Schema.NullOr(Schema.String), plan: Schema.NullOr(Schema.String) });
export const CodexAuthState = Schema.Struct({
  phase: Schema.Literals(["disconnected", "authorizing", "connected", "expired"]),
  method: Schema.NullOr(AuthMethod),
  account: Schema.NullOr(CodexAccount),
  message: Schema.NullOr(Schema.String),
});
export type CodexAuthState = typeof CodexAuthState.Type;
export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", { message: Schema.String }) {}
export const AuthRpc = RpcGroup.make(
  Rpc.make("codex.auth.watch", { success: CodexAuthState, error: AuthError, stream: true }),
  Rpc.make("codex.auth.login", { payload: { method: AuthMethod }, success: Schema.Void, error: AuthError }),
  Rpc.make("codex.auth.cancel", { success: Schema.Void, error: AuthError }),
  Rpc.make("codex.auth.logout", { success: Schema.Void, error: AuthError }),
);
