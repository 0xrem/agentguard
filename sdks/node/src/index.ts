export {
  AgentGuardClient,
  commandTarget,
  domainTarget,
  namedAgent,
  normalizeAgentIdentity,
  pathTarget,
  promptTarget,
  shouldDeny,
} from "./client.js";
export { AgentGuardHttpError, PendingApprovalError, PolicyDeniedError } from "./errors.js";
export {
  guardedExecCommand,
  guardedFetch,
  guardedReadFile,
  guardedWriteFile,
} from "./wrappers.js";
export type {
  ApprovalRequest,
  AgentIdentity,
  AgentLike,
  ApprovalStatus,
  AuditRecord,
  Decision,
  EnforcementAction,
  Event,
  EvaluationOutcome,
  EvaluationStatus,
  GuardEventInput,
  GuardedResult,
  Layer,
  Operation,
  ResourceTarget,
  RiskLevel,
  TrustLevel,
} from "./types.js";
export type {
  ExecCommandOutput,
  GuardedActionOptions,
  GuardedExecCommandOptions,
  GuardedFetchOptions,
  GuardedReadFileOptions,
  GuardedWriteFileOptions,
} from "./wrappers.js";
