import { Schema } from "effect";

/**
 * Who wrote a session's title, as T3 Code tracks it: "auto" is the placeholder or the first message's seed, "generated"
 * came from the text model, "manual" from a rename. Generated titles never replace a manual one.
 */
export const TitleSource = Schema.Literals(["auto", "generated", "manual"]);
export type TitleSource = typeof TitleSource.Type;
/** A regeneration in progress; the title stays as it is until it finishes. */
export const TitleRegeneration = Schema.Struct({ requestId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)), startedAt: Schema.Number });
export type TitleRegeneration = typeof TitleRegeneration.Type;
export const SessionTitleState = Schema.Struct({
  source: TitleSource,
  // Changes with every title write, so a generated title only lands on the title it was generated for.
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  // The first message did not say what the thread is about (a bare link, "fix this"); retitled after the first answer.
  needsRefinement: Schema.Boolean,
  regeneration: Schema.NullOr(TitleRegeneration),
});
export type SessionTitleState = typeof SessionTitleState.Type;
export const initialTitleState = (version: string): SessionTitleState => ({ source: "auto", version, needsRefinement: false, regeneration: null });
