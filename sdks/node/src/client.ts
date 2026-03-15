import { AgentGuardHttpError, PolicyDeniedError } from "./errors.js";
import type {
  AgentIdentity,
  AgentLike,
  AuditRecord,
  Event,
  GuardEventInput,
  ResourceTarget,
  RiskLevel,
} from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8790";

export interface AgentGuardClientOptions {
  baseUrl?: string;
  agent?: AgentLike;
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

export class AgentGuardClient {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly defaultAgent: AgentIdentity;
  readonly headers: HeadersInit | undefined;

  constructor(options: AgentGuardClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.AGENTGUARD_DAEMON_URL ?? DEFAULT_BASE_URL,
    );
    this.fetchImpl = options.fetch ?? fetch;
    this.defaultAgent = normalizeAgentIdentity(options.agent);
    this.headers = options.headers;
  }

  async recordEvent(event: Event): Promise<AuditRecord> {
    return this.request<AuditRecord>("/v1/events", {
      method: "POST",
      body: JSON.stringify(event),
    });
  }

  async listAudit(limit = 25): Promise<AuditRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    return this.request<AuditRecord[]>(`/v1/audit?limit=${safeLimit}`);
  }

  buildEvent(input: GuardEventInput): Event {
    return {
      layer: input.layer,
      operation: input.operation,
      target: input.target,
      risk_hint: input.riskHint ?? null,
      metadata: { ...(input.metadata ?? {}) },
      agent: normalizeAgentIdentity(input.agent ?? this.defaultAgent),
    };
  }

  async guardEvent(input: GuardEventInput): Promise<AuditRecord> {
    const record = await this.recordEvent(this.buildEvent(input));

    if (shouldDeny(record.decision.action)) {
      throw new PolicyDeniedError(record);
    }

    return record;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.headers ?? {}),
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw await buildHttpError(response);
    }

    return (await response.json()) as T;
  }
}

export function normalizeAgentIdentity(agent: AgentLike | AgentIdentity | undefined): AgentIdentity {
  if (typeof agent === "string") {
    return namedAgent(agent);
  }

  if (!agent) {
    return namedAgent("unknown-agent");
  }

  return {
    name: agent.name,
    executable_path: agent.executable_path ?? null,
    process_id: agent.process_id ?? null,
    parent_process_id: agent.parent_process_id ?? null,
    trust: agent.trust ?? "unknown",
  };
}

export function namedAgent(name: string): AgentIdentity {
  return {
    name,
    executable_path: null,
    process_id: null,
    parent_process_id: null,
    trust: "unknown",
  };
}

export function pathTarget(value: string): ResourceTarget {
  return { kind: "path", value };
}

export function commandTarget(value: string): ResourceTarget {
  return { kind: "command", value };
}

export function domainTarget(value: string): ResourceTarget {
  return { kind: "domain", value };
}

export function promptTarget(value: string): ResourceTarget {
  return { kind: "prompt", value };
}

export function shouldDeny(action: string): boolean {
  return action === "ask" || action === "block" || action === "kill";
}

export function withMetadata(
  metadata: Record<string, string> | undefined,
  additions: Record<string, string | undefined>,
): Record<string, string> {
  const merged: Record<string, string> = { ...(metadata ?? {}) };

  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function buildHttpError(response: Response): Promise<AgentGuardHttpError> {
  const contentType = response.headers.get("content-type") ?? "";
  let details: unknown = null;
  let message = `${response.status} ${response.statusText}`.trim();

  if (contentType.includes("application/json")) {
    details = await response.json();
    const maybeMessage =
      typeof details === "object" &&
      details !== null &&
      "error" in details &&
      typeof (details as { error?: { message?: unknown } }).error?.message === "string"
        ? (details as { error: { message: string } }).error.message
        : undefined;
    if (maybeMessage) {
      message = maybeMessage;
    }
  } else {
    const text = await response.text();
    if (text) {
      message = text;
      details = text;
    }
  }

  return new AgentGuardHttpError(message, response.status, details);
}

export type { RiskLevel };

