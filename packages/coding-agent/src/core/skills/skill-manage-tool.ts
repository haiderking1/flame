import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import { getFlameHome } from "../../utils/flame-home.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { executeSkillManage, type SkillManageActionOptions } from "./skill-manage-actions.ts";

const skillManageSchema = Type.Object({
	action: Type.Union(
		[
			Type.Literal("create"),
			Type.Literal("patch"),
			Type.Literal("edit"),
			Type.Literal("delete"),
			Type.Literal("write_file"),
			Type.Literal("remove_file"),
		],
		{ description: "The action to perform." },
	),
	name: Type.String({
		description:
			"Skill name (lowercase, hyphens/underscores, max 64 chars). Must match an existing skill for patch/edit/delete/write_file/remove_file.",
	}),
	content: Type.Optional(
		Type.String({
			description: "Full SKILL.md content (YAML frontmatter + markdown body). Required for 'create' and 'edit'.",
		}),
	),
	old_string: Type.Optional(
		Type.String({
			description: "Text to find in the file (required for 'patch'). Must be unique unless replace_all=true.",
		}),
	),
	new_string: Type.Optional(
		Type.String({
			description: "Replacement text (required for 'patch'). Can be empty string to delete the matched text.",
		}),
	),
	replace_all: Type.Optional(
		Type.Boolean({
			description: "For 'patch': replace all occurrences instead of requiring a unique match (default: false).",
		}),
	),
	category: Type.Optional(
		Type.String({
			description:
				"Optional category/domain for organizing the skill (e.g., 'devops'). Creates a subdirectory grouping. Only used with 'create'.",
		}),
	),
	file_path: Type.Optional(
		Type.String({
			description:
				"Path to a supporting file within the skill directory. For write_file/remove_file: required. For patch: optional, defaults to SKILL.md.",
		}),
	),
	file_content: Type.Optional(Type.String({ description: "Content for the file. Required for 'write_file'." })),
	absorbed_into: Type.Optional(
		Type.String({
			description:
				"For 'delete' only — umbrella skill name when merging content, or empty string when pruning with no target.",
		}),
	),
});

export type SkillManageInput = Static<typeof skillManageSchema>;

export interface SkillManageToolDetails {
	action: SkillManageInput["action"];
	name: string;
	success: boolean;
	message?: string;
	path?: string;
	error?: string;
}

const SKILL_MANAGE_DESCRIPTION =
	"Manage skills (create, update, delete). Skills are your procedural " +
	"memory — reusable approaches for recurring task types. " +
	`New skills go to ${getFlameHome()}/skills/; existing skills can be modified wherever they live.\n\n` +
	"Actions: create (full SKILL.md + optional category), " +
	"patch (old_string/new_string — preferred for fixes), " +
	"edit (full SKILL.md rewrite — major overhauls only), " +
	"delete, write_file, remove_file.\n\n" +
	"On delete, pass `absorbed_into=<umbrella>` when merging into another skill, " +
	'or `absorbed_into=""` when pruning with no forwarding target.\n\n' +
	"Create when: complex task succeeded (5+ calls), errors overcome, " +
	"user-corrected approach worked, non-trivial workflow discovered, " +
	"or user asks you to remember a procedure.\n" +
	"Update when: instructions stale/wrong, missing steps or pitfalls found during use. " +
	"If you used a skill and hit issues not covered by it, patch it immediately.\n\n" +
	"After difficult/iterative tasks, offer to save as a skill. " +
	"Skip for simple one-offs. Confirm with user before creating/deleting.\n\n" +
	"Good skills: trigger conditions, numbered steps with exact commands, " +
	"pitfalls section, verification steps. Use skill_view() to see format examples.";

export interface SkillManageToolOptions extends SkillManageActionOptions {}

export function createSkillManageToolDefinition(
	options: SkillManageToolOptions = {},
): ToolDefinition<typeof skillManageSchema, SkillManageToolDetails> {
	return {
		name: "skill_manage",
		label: "skill_manage",
		description: SKILL_MANAGE_DESCRIPTION,
		promptSnippet: "Create, patch, edit, or delete skills in the global skills library",
		promptGuidelines: [],
		parameters: skillManageSchema,

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const action = args?.action ?? "manage";
			const name = args?.name ?? "";
			const extra = args?.category
				? ` ${theme.fg("muted", `[${args.category}]`)}`
				: args?.file_path
					? ` ${theme.fg("muted", args.file_path)}`
					: "";
			text.setText(
				`${theme.fg("toolTitle", theme.bold("skill_manage"))} ${theme.fg("accent", `${action} ${name}`)}${extra}`,
			);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as SkillManageToolDetails | undefined;
			if (context.isError || details?.success === false) {
				const msg = details?.error ?? (result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "");
				text.setText(theme.fg("warning", msg.slice(0, 200)));
			} else if (options.isPartial) {
				text.setText(theme.fg("muted", "Working on skill..."));
			} else if (details?.success) {
				const verb = PAST_TENSE[details.action] ?? `${details.action}d`;
				const where = details.path ? ` ${theme.fg("muted", `→ ${details.path}`)}` : "";
				text.setText(theme.fg("toolOutput", `${verb} skill '${details.name}'${where}`));
			} else {
				const output = result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "";
				text.setText(theme.fg("toolOutput", output.slice(0, 200)));
			}
			return text;
		},

		async execute(_toolCallId, args) {
			const result = await executeSkillManage(args, options);
			const text = JSON.stringify(result, null, 2);
			return {
				content: [{ type: "text", text }],
				details: {
					action: args.action,
					name: args.name,
					success: result.success,
					message: result.message,
					path: result.path,
					error: result.error,
				},
			};
		},
	};
}

/** Human past-tense verb per action for the result line. */
const PAST_TENSE: Record<SkillManageInput["action"], string> = {
	create: "created",
	patch: "patched",
	edit: "edited",
	delete: "deleted",
	write_file: "wrote file to",
	remove_file: "removed file from",
};

export function createSkillManageTool(options: SkillManageToolOptions = {}) {
	const definition = createSkillManageToolDefinition(options);
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		execute: definition.execute,
	};
}
