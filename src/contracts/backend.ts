import { AuthRpc } from "./auth.js";
import { ProjectRpc } from "./projects.js";

import { UsageRpc } from "./usage.js";
import { ModelsRpc } from "./models.js";

export const BackendRpc = ProjectRpc.merge(AuthRpc, UsageRpc, ModelsRpc);
