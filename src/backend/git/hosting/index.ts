import type { SourceControlKind } from "../../../contracts/source-control.js";
import { github } from "./github.js";
import { gitlab } from "./gitlab.js";
import type { Hosting } from "./types.js";
export type { Hosting, HeadContext, CreatedRepository } from "./types.js";
export const hostings: readonly Hosting[] = [github, gitlab];
/** The CLI-backed hosting for a provider kind; other providers are detected for wording but have no CLI integration. */
export const hostingFor = (kind: SourceControlKind | null | undefined) => hostings.find(hosting => hosting.kind === kind) ?? null;
