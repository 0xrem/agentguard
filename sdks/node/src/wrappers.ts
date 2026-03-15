import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import {
  AgentGuardClient,
  commandTarget,
  domainTarget,
  pathTarget,
  withMetadata,
} from "./client.js";
import type {
  AgentLike,
  AuditRecord,
  GuardedResult,
  RiskLevel,
} from "./types.js";

const execAsync = promisify(execCallback);
const DEFAULT_WAIT_FOR_APPROVAL_MS = 30_000;

export interface GuardedActionOptions {
  agent?: AgentLike;
  metadata?: Record<string, string>;
  riskHint?: RiskLevel | null;
  waitForApprovalMs?: number;
}

export interface GuardedReadFileOptions extends GuardedActionOptions {
  encoding?: BufferEncoding | null;
}

export type GuardedWriteFileOptions = GuardedActionOptions & {
  encoding?: BufferEncoding | null;
  mode?: number;
  flag?: string;
};

export interface GuardedFetchOptions extends GuardedActionOptions {
  fetch?: typeof fetch;
}

export interface GuardedExecCommandOptions extends GuardedActionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: string;
  timeout?: number;
  maxBuffer?: number;
}

export interface ExecCommandOutput {
  stdout: string;
  stderr: string;
}

export async function guardedReadFile(
  client: AgentGuardClient,
  filePath: string,
  options: GuardedReadFileOptions = {},
): Promise<GuardedResult<string | Buffer>> {
  const resolvedPath = resolve(filePath);
  const auditRecord = await client.guardEvent({
    layer: "tool",
    operation: "read_file",
    target: pathTarget(resolvedPath),
    riskHint: options.riskHint,
    waitForApprovalMs: options.waitForApprovalMs ?? DEFAULT_WAIT_FOR_APPROVAL_MS,
    agent: options.agent,
    metadata: withMetadata(options.metadata, {
      requested_path: resolvedPath,
      encoding: options.encoding ?? undefined,
      cwd: process.cwd(),
      script_path: process.argv[1],
    }),
  });

  const value = options.encoding
    ? await readFile(resolvedPath, { encoding: options.encoding })
    : await readFile(resolvedPath);

  return { auditRecord, value };
}

export async function guardedWriteFile(
  client: AgentGuardClient,
  filePath: string,
  data: string | Uint8Array,
  options: GuardedWriteFileOptions = {},
): Promise<GuardedResult<void>> {
  const resolvedPath = resolve(filePath);
  const auditRecord = await client.guardEvent({
    layer: "tool",
    operation: "write_file",
    target: pathTarget(resolvedPath),
    riskHint: options.riskHint,
    waitForApprovalMs: options.waitForApprovalMs ?? DEFAULT_WAIT_FOR_APPROVAL_MS,
    agent: options.agent,
    metadata: withMetadata(options.metadata, {
      requested_path: resolvedPath,
      encoding:
        typeof options.encoding === "string" ? options.encoding : undefined,
      byte_length:
        typeof data === "string" ? String(Buffer.byteLength(data)) : String(data.byteLength),
      cwd: process.cwd(),
      script_path: process.argv[1],
    }),
  });

  const { agent, metadata, riskHint, ...writeOptions } = options;
  await writeFile(resolvedPath, data, writeOptions);

  return { auditRecord, value: undefined };
}

export async function guardedFetch(
  client: AgentGuardClient,
  input: string | URL,
  init: RequestInit = {},
  options: GuardedFetchOptions = {},
): Promise<GuardedResult<Response>> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const networkDirection =
    method === "GET" || method === "HEAD" ? "download" : "upload";
  const auditRecord = await client.guardEvent({
    layer: "tool",
    operation: "http_request",
    target: domainTarget(url.host),
    riskHint: options.riskHint,
    waitForApprovalMs: options.waitForApprovalMs ?? DEFAULT_WAIT_FOR_APPROVAL_MS,
    agent: options.agent,
    metadata: withMetadata(options.metadata, {
      method,
      url: request.url,
      network_direction: networkDirection,
      cwd: process.cwd(),
      script_path: process.argv[1],
    }),
  });

  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(request);

  return { auditRecord, value: response };
}

export async function guardedExecCommand(
  client: AgentGuardClient,
  command: string,
  options: GuardedExecCommandOptions = {},
): Promise<GuardedResult<ExecCommandOutput>> {
  const auditRecord: AuditRecord = await client.guardEvent({
    layer: "command",
    operation: "exec_command",
    target: commandTarget(command),
    riskHint: options.riskHint,
    waitForApprovalMs: options.waitForApprovalMs ?? DEFAULT_WAIT_FOR_APPROVAL_MS,
    agent: options.agent,
    metadata: withMetadata(options.metadata, {
      cwd: options.cwd ? resolve(options.cwd) : process.cwd(),
      script_path: process.argv[1],
    }),
  });

  const { stdout, stderr } = await execAsync(command, {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  });

  return {
    auditRecord,
    value: {
      stdout: Buffer.isBuffer(stdout) ? stdout.toString("utf8") : stdout,
      stderr: Buffer.isBuffer(stderr) ? stderr.toString("utf8") : stderr,
    },
  };
}
