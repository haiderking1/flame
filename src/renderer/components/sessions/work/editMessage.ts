import { createContext } from "react";
import type { SessionEntry } from "@contracts/sessions";

/** "Edit from here" for user messages in the timeline; absent where history cannot be rewound. */
export const EditMessageContext = createContext<{ request(entry: SessionEntry): void; disabled: boolean } | null>(null);
