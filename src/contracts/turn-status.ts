import { Schema } from "effect";
export const TurnStatus = Schema.Literals(["running", "completed", "cancelled", "failed", "interrupted"]);
export type TurnStatus = typeof TurnStatus.Type;
