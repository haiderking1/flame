import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

const Path = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));
export const Project = Schema.Struct({ id: Schema.String, name: Schema.String, path: Path, createdAt: Schema.Number });
export type Project = typeof Project.Type;
export const Directory = Schema.Struct({ name: Schema.String, path: Path });
export const BrowseResult = Schema.Struct({
  path: Path, parent: Schema.NullOr(Path), entries: Schema.Array(Directory), truncated: Schema.Boolean,
});
export type BrowseResult = typeof BrowseResult.Type;
export class ProjectError extends Schema.TaggedError<ProjectError>()("ProjectError", {
  code: Schema.Literals(["NOT_FOUND", "NOT_DIRECTORY", "PERMISSION", "INVALID_PATH", "STORAGE", "UNAVAILABLE"]),
  message: Schema.String,
}) {}
export const ProjectRpc = RpcGroup.make(
  Rpc.make("filesystem.browse", { payload: { path: Path }, success: BrowseResult, error: ProjectError }),
  Rpc.make("projects.add", { payload: { path: Path }, success: Project, error: ProjectError }),
  Rpc.make("projects.watch", { success: Schema.Array(Project), error: ProjectError, stream: true }),
);
