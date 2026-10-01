import HighlightWorker from "./highlight.worker?worker";
import { createHighlightClient } from "./highlighting/client";
export type { Token, Highlight } from "./highlighting/types";
const client = createHighlightClient(() => new HighlightWorker());
export const highlight = client.highlight;
window.addEventListener("pagehide", client.dispose);
if (import.meta.hot) import.meta.hot.dispose(client.dispose);
