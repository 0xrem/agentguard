import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";

import {
  AgentGuardClient,
  PolicyDeniedError,
  guardedExecCommand,
  guardedFetch,
  guardedReadFile,
} from "../src/index.js";
import type { AuditRecord, Decision, Event } from "../src/types.js";

interface MockDaemon {
  url: string;
  records: AuditRecord[];
  events: Event[];
  close: () => Promise<void>;
}

const openServers: Array<() => Promise<void>> = [];

after(async () => {
  await Promise.all(openServers.map((close) => close()));
});

test("client records events and lists audit entries", async () => {
  const daemon = await startMockDaemon();
  const client = new AgentGuardClient({
    baseUrl: daemon.url,
    agent: "Claude Code",
  });

  const record = await client.guardEvent({
    layer: "command",
    operation: "exec_command",
    target: { kind: "command", value: "rm -rf ~" },
  });
  const recent = await client.listAudit(5);

  assert.equal(record.event.agent.name, "Claude Code");
  assert.equal(recent.length, 1);
  assert.equal(recent[0].decision.action, "allow");
});

test("guardedReadFile reads when daemon allows", async () => {
  const daemon = await startMockDaemon();
  const client = new AgentGuardClient({
    baseUrl: daemon.url,
    agent: "Coding Assistant",
  });
  const dir = await mkdtemp(join(tmpdir(), "agentguard-node-sdk-"));
  const filePath = join(dir, "example.txt");
  await writeFile(filePath, "safe file", "utf8");

  const result = await guardedReadFile(client, filePath, { encoding: "utf8" });

  assert.equal(result.value, "safe file");
  assert.equal(daemon.events[0]?.operation, "read_file");
  assert.equal(daemon.events[0]?.target.kind, "path");
});

test("guardedFetch emits an http_request event before forwarding", async () => {
  const daemon = await startMockDaemon();
  const upstream = await startTextServer("ok");
  const client = new AgentGuardClient({
    baseUrl: daemon.url,
    agent: "AutoGPT",
  });

  const result = await guardedFetch(client, `${upstream.url}/status`, {
    method: "POST",
    body: JSON.stringify({ hello: "world" }),
  });

  assert.equal(result.auditRecord.event.operation, "http_request");
  assert.equal(result.auditRecord.event.target.kind, "domain");
  assert.equal(await result.value.text(), "ok");
});

test("guardedExecCommand throws before execution when daemon blocks", async () => {
  const daemon = await startMockDaemon((_event) => ({
    action: "block",
    risk: "critical",
    reason: "command blocked",
    matched_rule_id: "blocked-in-test",
  }));
  const client = new AgentGuardClient({
    baseUrl: daemon.url,
    agent: "Claude Code",
  });

  await assert.rejects(
    () => guardedExecCommand(client, "echo should-not-run"),
    (error: unknown) => {
      assert.ok(error instanceof PolicyDeniedError);
      assert.equal(error.record.decision.action, "block");
      return true;
    },
  );
});

async function startMockDaemon(
  decide: (event: Event) => Decision = () => ({
    action: "allow",
    risk: "low",
    reason: "allowed in mock daemon",
    matched_rule_id: null,
  }),
): Promise<MockDaemon> {
  const records: AuditRecord[] = [];
  const events: Event[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/v1/events") {
      const event = (await readJsonBody(request)) as Event;
      events.push(event);
      const record: AuditRecord = {
        id: records.length + 1,
        recorded_at_unix_ms: Date.now(),
        event,
        decision: decide(event),
      };
      records.unshift(record);
      return sendJson(response, 200, record);
    }

    if (request.method === "GET" && request.url?.startsWith("/v1/audit")) {
      return sendJson(response, 200, records);
    }

    return sendJson(response, 404, {
      error: {
        message: "not found",
        type: "invalid_request_error",
      },
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("mock daemon failed to bind to an address");
  }

  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  openServers.push(close);

  return {
    url: `http://127.0.0.1:${address.port}`,
    records,
    events,
    close,
  };
}

async function startTextServer(text: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(text);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("text server failed to bind to an address");
  }

  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  openServers.push(close);

  return {
    url: `http://127.0.0.1:${address.port}`,
    close,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
