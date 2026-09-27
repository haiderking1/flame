import { Effect, PubSub, Stream } from "effect";
import { ProjectError, ProjectRpc } from "../../contracts/projects.js";
import { browseDirectory, canonicalDirectory, filesystemError } from "./filesystem.js";
import { ProjectStore } from "./store.js";

const storageError = () => new ProjectError({ code: "STORAGE", message: "Projects could not be saved or loaded. Check available disk space and permissions." });

export function projectHandlers(store: ProjectStore) {
  return ProjectRpc.toLayer(Effect.gen(function* () {
    const changes = yield* PubSub.sliding<void>(1);
    const list = Effect.try({ try: () => store.list(), catch: storageError });
    return {
      "filesystem.browse": ({ path }) => Effect.tryPromise({ try: (signal) => browseDirectory(path, signal), catch: filesystemError }),
      "projects.add": ({ path }) => Effect.gen(function* () {
        const canonical = yield* Effect.tryPromise({ try: () => canonicalDirectory(path), catch: filesystemError });
        // Once a mutation begins, persist and publish together even if the caller disconnects.
        return yield* Effect.gen(function* () {
          const project = yield* Effect.try({ try: () => store.add(canonical), catch: storageError });
          yield* PubSub.publish(changes, undefined);
          return project;
        }).pipe(Effect.uninterruptible);
      }),
      "projects.watch": () => Stream.unwrap(Effect.gen(function* () {
        const queue = yield* PubSub.subscribe(changes);
        return Stream.concat(Stream.fromEffect(list), Stream.fromSubscription(queue).pipe(Stream.mapEffect(() => list)));
      })),
    };
  }));
}
