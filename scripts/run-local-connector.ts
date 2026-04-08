import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { homedir, hostname, platform, tmpdir } from "os";
import { join } from "path";
import type { AiCompletionTaskPayload, ConnectorTaskPayload } from "~/premium/ai/connector-protocol";

type SupportedTool = "codex" | "claude-code";

type ConnectorTask = {
  id: string;
  taskType: string;
  payload: ConnectorTaskPayload;
};

type ConnectorResult = {
  type: "ai_completion";
  content: string;
  tool: string;
  model?: string;
  provider?: string;
  tokensUsed?: { input: number; output: number };
};

type DetectedTools = Partial<Record<SupportedTool, string>>;

const NETWORK_RETRY_ATTEMPTS = Number(process.env.PROOFMARK_CONNECTOR_FETCH_RETRIES ?? 5);
const NETWORK_RETRY_BASE_MS = Number(process.env.PROOFMARK_CONNECTOR_FETCH_BACKOFF_MS ?? 1000);

function readArg(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

function getRequiredConfig(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value?.trim()) {
    throw new Error(`Missing required config: ${name}`);
  }
  return value.trim();
}

function runCommand(command: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 16,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBinary(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;

    if (candidate.includes("/") && existsSync(candidate)) {
      return candidate;
    }

    const whichResult = runCommand("which", [candidate]);
    if (whichResult.status === 0) {
      const resolved = whichResult.stdout.trim().split("\n")[0];
      if (resolved) return resolved;
    }
  }

  return null;
}

function detectTools(): DetectedTools {
  const codex = resolveBinary([
    process.env.PROOFMARK_CODEX_BIN ?? "",
    "/Applications/Codex.app/Contents/Resources/codex",
    "codex",
  ]);

  const claude = resolveBinary([
    process.env.PROOFMARK_CLAUDE_BIN ?? "",
    join(homedir(), ".local/bin/claude"),
    "claude",
  ]);

  return {
    ...(codex ? { codex } : {}),
    ...(claude ? { "claude-code": claude } : {}),
  };
}

function stableMachineId(workdir: string): string {
  return createHash("sha256").update(`${hostname()}|${platform()}|${workdir}`).digest("hex").slice(0, 32);
}

function buildPrompt(payload: AiCompletionTaskPayload): string {
  const parts: string[] = [
    "You are fulfilling a Proofmark local connector completion task.",
    "Return only the final assistant response for the conversation below.",
    "Do not mention the connector, local tooling, or execution environment.",
  ];

  if (payload.responseFormat === "json") {
    parts.push("The final answer must be strict JSON only.");
  }

  parts.push("", "Conversation:");

  for (const message of payload.messages) {
    parts.push(`[${message.role.toUpperCase()}]`, message.content, "");
  }

  if (payload.contextFiles?.length) {
    parts.push("Context files:");
    for (const file of payload.contextFiles) {
      parts.push(`FILE: ${file.path}`, file.content, "");
    }
  }

  return parts.join("\n");
}

function maybeAddModelHint(
  args: string[],
  tool: SupportedTool,
  providerHint: string | undefined,
  modelHint: string | undefined,
) {
  if (!modelHint) return false;
  if (tool === "claude-code" && (providerHint === "anthropic" || modelHint.startsWith("claude"))) {
    args.push("--model", modelHint);
    return true;
  }
  if (
    tool === "codex" &&
    process.env.PROOFMARK_CODEX_ALLOW_MODEL_HINT === "1" &&
    (providerHint === "openai" || modelHint.startsWith("gpt") || modelHint.startsWith("o"))
  ) {
    args.push("--model", modelHint);
    return true;
  }
  return false;
}

function estimateTokens(input: string, output: string) {
  return {
    input: Math.max(1, Math.ceil(input.length / 4)),
    output: Math.max(1, Math.ceil(output.length / 4)),
  };
}

function runCodex(binary: string, prompt: string, workdir: string, payload: AiCompletionTaskPayload): ConnectorResult {
  const tempDir = mkdtempSync(join(tmpdir(), "proofmark-codex-"));
  const outputFile = join(tempDir, "last-message.txt");
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--cd",
    workdir,
    "--color",
    "never",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--output-last-message",
    outputFile,
  ];

  const appliedModelHint = maybeAddModelHint(args, "codex", payload.providerHint, payload.modelHint);
  args.push(prompt);

  const result = runCommand(binary, args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "codex execution failed");
  }

  const content = existsSync(outputFile) ? readFileSync(outputFile, "utf8").trim() : result.stdout.trim();
  if (!content) throw new Error("codex returned an empty response");

  return {
    type: "ai_completion",
    content,
    tool: "codex",
    model: appliedModelHint ? payload.modelHint : "local-codex",
    provider: payload.providerHint,
    tokensUsed: estimateTokens(prompt, content),
  };
}

function runClaude(binary: string, prompt: string, payload: AiCompletionTaskPayload): ConnectorResult {
  const args = ["-p", "--output-format", "text", "--permission-mode", "bypassPermissions", "--no-session-persistence"];

  const appliedModelHint = maybeAddModelHint(args, "claude-code", payload.providerHint, payload.modelHint);
  args.push(prompt);

  const result = runCommand(binary, args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "claude execution failed");
  }

  const content = result.stdout.trim();
  if (!content) throw new Error("claude returned an empty response");

  return {
    type: "ai_completion",
    content,
    tool: "claude-code",
    model: appliedModelHint ? payload.modelHint : "local-claude-code",
    provider: payload.providerHint,
    tokensUsed: estimateTokens(prompt, content),
  };
}

function normalizeRequestedTool(tool: string | undefined): SupportedTool | "auto" {
  if (tool === "codex" || tool === "claude-code") return tool;
  if (tool === "claude") return "claude-code";
  return "auto";
}

function orderedTools(payload: AiCompletionTaskPayload, detected: DetectedTools): SupportedTool[] {
  const requested = normalizeRequestedTool(payload.tool);
  if (requested !== "auto") return requested in detected ? [requested] : [];

  const byProvider =
    payload.providerHint === "anthropic"
      ? (["claude-code", "codex"] as SupportedTool[])
      : payload.providerHint === "openai"
        ? (["codex", "claude-code"] as SupportedTool[])
        : (["codex", "claude-code"] as SupportedTool[]);

  return byProvider.filter((tool, index) => tool in detected && byProvider.indexOf(tool) === index);
}

function executeAiCompletionTask(
  payload: AiCompletionTaskPayload,
  detected: DetectedTools,
  workdir: string,
): ConnectorResult {
  const prompt = buildPrompt(payload);
  const tools = orderedTools(payload, detected);
  if (tools.length === 0) {
    throw new Error("No compatible local AI tool is installed for this connector task");
  }

  const errors: string[] = [];
  for (const tool of tools) {
    try {
      if (tool === "codex" && detected.codex) {
        return runCodex(detected.codex, prompt, workdir, payload);
      }
      if (tool === "claude-code" && detected["claude-code"]) {
        return runClaude(detected["claude-code"], prompt, payload);
      }
    } catch (error) {
      errors.push(`${tool}: ${(error as Error).message}`);
    }
  }

  throw new Error(errors.join(" | "));
}

async function postJson<T>(url: string, token: string, body: Record<string, unknown>): Promise<T> {
  return fetchJsonWithRetry<T>(url, token, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function getJson<T>(url: string, token: string): Promise<T> {
  return fetchJsonWithRetry<T>(url, token);
}

async function fetchJsonWithRetry<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= NETWORK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });

      if (!response.ok) {
        const message = `${url} returned ${response.status}: ${await response.text()}`;
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          throw new Error(message);
        }
        lastError = new Error(message);
      } else {
        return (await response.json()) as T;
      }
    } catch (error) {
      lastError = error as Error;
      const message = lastError.message;
      const fatal = /401|403|404/.test(message);
      if (fatal || attempt === NETWORK_RETRY_ATTEMPTS) {
        throw lastError;
      }
    }

    await sleep(NETWORK_RETRY_BASE_MS * attempt);
  }

  throw lastError ?? new Error("connector fetch failed");
}

async function processTask(
  baseUrl: string,
  token: string,
  task: ConnectorTask,
  detected: DetectedTools,
  workdir: string,
) {
  try {
    if (task.taskType !== "ai_completion" || task.payload.type !== "ai_completion") {
      throw new Error(`Unsupported connector task type: ${task.taskType}`);
    }

    const result = executeAiCompletionTask(task.payload, detected, workdir);
    await postJson(`${baseUrl}/api/connector/poll`, token, {
      taskId: task.id,
      status: "completed",
      result,
    });
  } catch (error) {
    await postJson(`${baseUrl}/api/connector/poll`, token, {
      taskId: task.id,
      status: "failed",
      result: {
        error: (error as Error).message,
      },
    });
  }
}

async function pollLoop(
  baseUrl: string,
  token: string,
  sessionId: string,
  detected: DetectedTools,
  workdir: string,
): Promise<void> {
  while (true) {
    try {
      const poll = await getJson<{ tasks: ConnectorTask[] }>(
        `${baseUrl}/api/connector/poll?sessionId=${encodeURIComponent(sessionId)}`,
        token,
      );
      for (const task of poll.tasks) {
        await processTask(baseUrl, token, task, detected, workdir);
      }
    } catch (error) {
      const message = (error as Error).message;
      console.error(`[local-connector] ${message}`);
      if (/401|403|404|session/i.test(message)) return;
      await sleep(NETWORK_RETRY_BASE_MS);
    }
  }
}

async function main() {
  const workdir = process.env.PROOFMARK_CONNECTOR_WORKDIR ?? process.cwd();
  const baseUrl = getRequiredConfig("PROOFMARK_CONNECTOR_URL", readArg("--url") ?? "http://127.0.0.1:3100");
  const token = getRequiredConfig("PROOFMARK_CONNECTOR_TOKEN", readArg("--token"));
  const label = process.env.PROOFMARK_CONNECTOR_LABEL ?? `Local Connector (${hostname()})`;
  const detected = detectTools();

  const supportedTools = Object.keys(detected);
  if (supportedTools.length === 0) {
    throw new Error("No supported local AI tools were found. Install Codex or Claude Code first.");
  }

  while (true) {
    try {
      const register = await postJson<{ sessionId: string }>(`${baseUrl}/api/connector/register`, token, {
        connectorVersion: "local-ts-0.1.0",
        machineId: stableMachineId(workdir),
        label,
        capabilities: {
          supportedTools,
          localModels: supportedTools.map((tool) => `local-${tool}`),
          maxConcurrency: 1,
        },
      });

      console.log(`connector online: ${register.sessionId}`);
      console.log(`tools: ${supportedTools.join(", ")}`);

      await pollLoop(baseUrl, token, register.sessionId, detected, workdir);
    } catch (error) {
      const message = (error as Error).message;
      console.error(`[local-connector] ${message}`);
      if (/401|403/.test(message)) {
        process.exit(1);
      }
      await sleep(NETWORK_RETRY_BASE_MS * 2);
    }
  }
}

main().catch((error) => {
  console.error(`[local-connector] ${(error as Error).message}`);
  process.exit(1);
});
