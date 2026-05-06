import type { AgentTool } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolPermissionRequest } from "../../src/core/permissions.js";
import { createHarness, getAssistantTexts, getMessageText, type Harness } from "./harness.js";

describe("AgentSession tool permission enforcement", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	function createEchoTool(onExecute: () => void): AgentTool {
		return {
			name: "echo",
			label: "Echo",
			description: "Echo text back",
			parameters: Type.Object({ text: Type.String() }),
			execute: async () => {
				onExecute();
				return { content: [{ type: "text", text: "echoed" }], details: undefined };
			},
		};
	}

	function setToolUseResponses(
		harness: Harness,
		toolName = "echo",
		args: Record<string, unknown> = { text: "hi" },
	): void {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall(toolName, args)], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = context.messages.find((message) => message.role === "toolResult");
				const text =
					toolResult?.role === "toolResult"
						? toolResult.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage(text);
			},
		]);
	}

	function getToolResultTexts(harness: Harness): string[] {
		return harness.session.messages
			.filter((message) => message.role === "toolResult")
			.map((message) => getMessageText(message));
	}

	it("keeps default behavior unchanged without a permission policy", async () => {
		let executeCount = 0;
		const harness = await createHarness({ tools: [createEchoTool(() => executeCount++)] });
		harnesses.push(harness);
		setToolUseResponses(harness);

		await harness.session.prompt("call echo");

		expect(executeCount).toBe(1);
		expect(getAssistantTexts(harness)).toContain("echoed");
	});

	it("fails closed when approval is required without a permission handler", async () => {
		let executeCount = 0;
		const harness = await createHarness({ tools: [createEchoTool(() => executeCount++)] });
		harnesses.push(harness);
		harness.session.setToolApprovalMode("echo", "always");
		setToolUseResponses(harness);

		await harness.session.prompt("call echo");

		expect(executeCount).toBe(0);
		expect(getToolResultTexts(harness)).toContain(
			"Approval required for echo, but no permission handler is available.",
		);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("runs extension tool_call handlers after approval allows execution", async () => {
		let executeCount = 0;
		let extensionToolCallCount = 0;
		const harness = await createHarness({
			tools: [createEchoTool(() => executeCount++)],
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", () => {
						extensionToolCallCount++;
					});
				},
			],
		});
		harnesses.push(harness);
		harness.session.setToolApprovalMode("echo", "always");
		harness.session.setToolPermissionHandler(async () => ({ decision: "allow" }));
		setToolUseResponses(harness);

		await harness.session.prompt("call echo");

		expect(extensionToolCallCount).toBe(1);
		expect(executeCount).toBe(1);
	});

	it("blocks denied tool calls before extension tool_call handlers", async () => {
		let executeCount = 0;
		let extensionToolCallCount = 0;
		const harness = await createHarness({
			tools: [createEchoTool(() => executeCount++)],
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", () => {
						extensionToolCallCount++;
					});
				},
			],
		});
		harnesses.push(harness);
		harness.session.setToolApprovalMode("echo", "always");
		harness.session.setToolPermissionHandler(async () => ({ decision: "deny", reason: "Denied by test" }));
		setToolUseResponses(harness);

		await harness.session.prompt("call echo");

		expect(extensionToolCallCount).toBe(0);
		expect(executeCount).toBe(0);
		expect(getToolResultTexts(harness)).toContain("Denied by test");
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("sends denied tool results on the next user turn after terminating", async () => {
		let executeCount = 0;
		let sawDeniedToolResult = false;
		const harness = await createHarness({ tools: [createEchoTool(() => executeCount++)] });
		harnesses.push(harness);
		harness.session.setToolApprovalMode("echo", "always");
		harness.session.setToolPermissionHandler(async () => ({ decision: "deny", reason: "Denied by test" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hi" })], { stopReason: "toolUse" }),
			(context) => {
				sawDeniedToolResult = context.messages.some(
					(message) => message.role === "toolResult" && getMessageText(message).includes("Denied by test"),
				);
				return fauxAssistantMessage(sawDeniedToolResult ? "saw denied tool result" : "missing denied tool result");
			},
		]);

		await harness.session.prompt("call echo");

		expect(executeCount).toBe(0);
		expect(getToolResultTexts(harness)).toContain("Denied by test");
		expect(harness.getPendingResponseCount()).toBe(1);

		await harness.session.prompt("continue");

		expect(sawDeniedToolResult).toBe(true);
		expect(getAssistantTexts(harness)).toContain("saw denied tool result");
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("passes none preview when the tool has no preview hook", async () => {
		let request: ToolPermissionRequest | undefined;
		const harness = await createHarness({ tools: [createEchoTool(() => {})] });
		harnesses.push(harness);
		harness.session.setToolApprovalMode("echo", "always");
		harness.session.setToolPermissionHandler(async (nextRequest) => {
			request = nextRequest;
			return { decision: "deny", reason: "stop" };
		});
		setToolUseResponses(harness);

		await harness.session.prompt("call echo");

		expect(request?.preview).toEqual({ kind: "none" });
	});

	it("builds approval previews from tool definitions", async () => {
		let request: ToolPermissionRequest | undefined;
		const harness = await createHarness();
		harnesses.push(harness);
		harness.session.setToolApprovalMode("write", "always");
		harness.session.setToolPermissionHandler(async (nextRequest) => {
			request = nextRequest;
			return { decision: "deny", reason: "stop" };
		});
		setToolUseResponses(harness, "write", { path: "created.ts", content: "export const value = 1;\n" });

		await harness.session.prompt("write a file");

		expect(request?.toolName).toBe("write");
		expect(request?.input).toEqual({ path: "created.ts", content: "export const value = 1;\n" });
		expect(request?.preview).toEqual({
			kind: "text",
			path: "created.ts",
			content: "export const value = 1;\n",
			language: "typescript",
		});
	});
});
