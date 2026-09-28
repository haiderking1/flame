import { AuthRpc } from "./auth.js";
import { ProjectRpc } from "./projects.js";

import { UsageRpc } from "./usage.js";
import { ModelsRpc } from "./models.js";

import { SessionRpc } from "./sessions.js";

import { TurnRpc } from "./turns.js";
import { BashRpc } from "./bash.js";
export const BackendRpc = ProjectRpc.merge(AuthRpc, UsageRpc, ModelsRpc, SessionRpc, TurnRpc, BashRpc);
