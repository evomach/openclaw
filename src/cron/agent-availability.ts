import { readAgentDatabaseAdmissionRefusal } from "../state/agent-database-admission.js";

/** Transaction facts travel from the worker; resident configuration stays with the host. */
type CronAgentAvailabilityFacts = { deletionBlocked: boolean };
export type CronAgentAvailability = (agentId: string, facts: CronAgentAvailabilityFacts) => boolean;

/** Agent lifecycle owns this refusal; monitor reconciliation may retry once admitted. */
export class CronAgentLifecycleDeferredError extends Error {
  constructor(agentId: string, env?: NodeJS.ProcessEnv) {
    super(describeUnavailableCronAgent(agentId, env));
    this.name = "CronAgentLifecycleDeferredError";
  }
}

export function isCronAgentLifecycleDeferredError(error: unknown): boolean {
  // The SQLite worker transports the error name without its JavaScript prototype.
  return error instanceof Error && error.name === "CronAgentLifecycleDeferredError";
}

export function createUnavailableCronAgentError(agentId: string, env?: NodeJS.ProcessEnv): Error {
  return readAgentDatabaseAdmissionRefusal(agentId, { env })?.code ===
    "agent-database-inspection-pending"
    ? new CronAgentLifecycleDeferredError(agentId, env)
    : new Error(describeUnavailableCronAgent(agentId, env));
}

export function describeUnavailableCronAgent(agentId: string, env?: NodeJS.ProcessEnv): string {
  const refusal = readAgentDatabaseAdmissionRefusal(agentId, { env });
  return refusal
    ? `${refusal.reason}\n${refusal.repairHint}`
    : `cron job agent is unavailable: ${agentId}`;
}
