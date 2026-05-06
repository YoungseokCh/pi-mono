export type PermissionDecision = "allow" | "deny";
export type PermissionMode = "never" | "always";

export type ToolPreview = ToolPreviewDiff | ToolPreviewText | ToolPreviewError | ToolPreviewNone;

export interface ToolPreviewBase {
	title?: string;
	path?: string;
}

export interface ToolPreviewDiff extends ToolPreviewBase {
	kind: "diff";
	content: string;
	firstChangedLine?: number;
}

export interface ToolPreviewText extends ToolPreviewBase {
	kind: "text";
	content: string;
	language?: string;
}

export interface ToolPreviewError extends ToolPreviewBase {
	kind: "error";
	error: string;
}

export interface ToolPreviewNone {
	kind: "none";
}

export interface ToolPermissionRequest {
	type: "tool_call";
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
	preview: ToolPreview;
}

export interface PermissionResult {
	decision: PermissionDecision;
	reason?: string;
}

export type ToolPermissionHandler = (request: ToolPermissionRequest) => Promise<PermissionResult>;
