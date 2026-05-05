import { afterEach, describe, expect, it, vi } from "vitest";
import { loginOpenAICodex } from "../src/utils/oauth/openai-codex.js";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function getUrl(input: unknown): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	if (input instanceof Request) return input.url;
	throw new Error(`Unsupported fetch input: ${String(input)}`);
}

function createAccessToken(accountId = "acct_123"): string {
	const payload = Buffer.from(
		JSON.stringify({
			"https://api.openai.com/auth": { chatgpt_account_id: accountId },
		}),
	).toString("base64url");
	return `header.${payload}.sig`;
}

describe("OpenAI Codex OAuth device flow", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("uses headless device flow and returns OAuth credentials", async () => {
		vi.useFakeTimers();
		const startTime = new Date("2026-03-25T00:00:00Z");
		vi.setSystemTime(startTime);

		const authUrls: Array<{ url: string; instructions?: string }> = [];
		const pollTimes: number[] = [];
		const accessToken = createAccessToken("acct_123");
		let loginMethodOptions: string[] = [];

		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const url = getUrl(input);
			if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
				expect(init?.method).toBe("POST");
				return jsonResponse({ device_auth_id: "device-auth-id", user_code: "ABCD-EFGH", interval: "5" });
			}
			if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
				pollTimes.push(Date.now());
				return jsonResponse({ authorization_code: "device-code", code_verifier: "device-verifier" });
			}
			if (url === "https://auth.openai.com/oauth/token") {
				expect(String(init?.body)).toContain("redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback");
				return jsonResponse({ access_token: accessToken, refresh_token: "refresh-token", expires_in: 3600 });
			}
			throw new Error(`Unexpected fetch URL: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const loginPromise = loginOpenAICodex({
			onAuth: (info) => authUrls.push(info),
			onPrompt: async (prompt) => {
				loginMethodOptions = prompt.options?.map((option) => option.value) ?? [];
				return "headless";
			},
		});

		await vi.advanceTimersByTimeAsync(4999);
		expect(pollTimes).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);

		await expect(loginPromise).resolves.toEqual({
			access: accessToken,
			refresh: "refresh-token",
			expires: startTime.getTime() + 5000 + 3600 * 1000,
			accountId: "acct_123",
		});
		expect(authUrls).toEqual([
			{ url: "https://auth.openai.com/codex/device", instructions: "Enter code: ABCD-EFGH" },
		]);
		expect(loginMethodOptions).toEqual(["browser", "headless"]);
	});

	it("rejects invalid login methods", async () => {
		await expect(
			loginOpenAICodex({
				onAuth: () => {},
				onPrompt: async () => "bad-method",
			}),
		).rejects.toThrow("Invalid login method: bad-method. Expected headless or browser.");
	});
});
