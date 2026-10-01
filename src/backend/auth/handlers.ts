import { Effect, Queue, Stream } from "effect";
import { AuthError, AuthRpc, type CodexAuthState } from "../../contracts/auth.js";
import { OAuthFailure } from "./credentials.js";
import type { CodexAuth } from "./service.js";

export function authHandlers(auth: CodexAuth) {
  const operation = (work: () => Promise<void>) => Effect.tryPromise({ try: work,
    catch: (error) => new AuthError({ message: error instanceof OAuthFailure ? error.message : "OpenAI authentication could not complete. Try again." }),
  }).pipe(Effect.uninterruptible);
  return AuthRpc.toLayer({
    "codex.auth.watch": () => Stream.callback<CodexAuthState>((queue) => Effect.acquireRelease(
      Effect.sync(() => {
        const publish = () => { Queue.offerUnsafe(queue, auth.state); };
        auth.on("change", publish);
        publish();
        return publish;
      }),
      (publish) => Effect.sync(() => { auth.removeListener("change", publish); }),
    ), { bufferSize: 1, strategy: "sliding" }),
    "codex.auth.login": ({ method }) => Effect.sync(() => auth.login(method)),
    "codex.auth.cancel": () => operation(() => auth.cancel()),
    "codex.auth.logout": () => operation(() => auth.logout()),
  });
}
