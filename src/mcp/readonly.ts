/**
 * Read-only enforcement for MCP tools.
 *
 * The PRD requires the CockroachDB Cloud MCP connection to be read-only. That
 * is asked of the server (see `client.ts`), but it is not *trusted* from the
 * server: this module re-decides, on our side, whether each advertised tool is
 * allowed to run. An MCP server is a remote party whose tool list can change
 * between deploys, and the agent picking tool names is a language model. A
 * connection that is read-only only because the far end said so is one
 * misconfiguration away from letting an LLM issue DDL against a production
 * cluster.
 *
 * Two gates, applied at both discovery and call time:
 *
 *  1. DENY wins. Any tool whose name contains a mutating verb is rejected even
 *     if the server annotates it `readOnlyHint: true`.
 *  2. Then ALLOW. A tool must either be annotated read-only by the server or
 *     match the schema-exploration vocabulary the PRD actually asks for.
 *
 * Unrecognised and unannotated tools are dropped. Failing closed costs us a
 * tool; failing open costs the customer a table.
 */

/** Mutating verbs. Matched as whole words against the tokenised tool name. */
const DENIED_VERBS = new Set([
  'insert',
  'update',
  'delete',
  'drop',
  'truncate',
  'alter',
  'create',
  'grant',
  'revoke',
  'write',
  'execute',
  'exec',
  'run',
  'import',
  'restore',
  'backup',
  'set',
  'upsert',
  'merge',
  'copy',
  'rename',
  'kill',
  'cancel',
  'pause',
  'resume',
]);

/** Schema-exploration verbs — the read surface the agent is meant to have. */
const ALLOWED_VERBS = new Set([
  'list',
  'get',
  'describe',
  'show',
  'explain',
  'schema',
  'schemas',
  'table',
  'tables',
  'column',
  'columns',
  'index',
  'indexes',
  'database',
  'databases',
  'cluster',
  'clusters',
  'query',
  'select',
  'search',
  'read',
  'inspect',
  'info',
  'stats',
  'metadata',
]);

/** Split `describe_table`, `describeTable` and `describe-table` alike. */
export function tokenizeToolName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export type ReadOnlyVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Decide whether an MCP tool may be exposed to the agent and executed.
 *
 * `query` and `select` are in the allow list deliberately: a read-only SQL
 * endpoint is the single most useful thing the MCP server offers, and the
 * server is responsible for rejecting writes on a connection we opened
 * read-only. What this gate guarantees is that we never *call* a tool whose
 * own name advertises a mutation.
 */
export function isReadOnlyTool(
  name: string,
  annotations?: ToolAnnotations,
): ReadOnlyVerdict {
  const tokens = tokenizeToolName(name);
  if (tokens.length === 0) {
    return { allowed: false, reason: 'tool name is empty' };
  }

  const denied = tokens.find((token) => DENIED_VERBS.has(token));
  if (denied) {
    return {
      allowed: false,
      reason: `name contains the mutating verb '${denied}'`,
    };
  }

  // An explicit destructive hint is disqualifying on its own.
  if (annotations?.destructiveHint === true) {
    return { allowed: false, reason: 'server annotated it as destructive' };
  }

  if (annotations?.readOnlyHint === true) {
    return { allowed: true };
  }

  if (tokens.some((token) => ALLOWED_VERBS.has(token))) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'not annotated read-only and not a recognised schema-exploration tool',
  };
}
