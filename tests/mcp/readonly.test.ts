import { afterEach, describe, expect, it } from 'vitest';
import {
  CockroachMCPClient,
  DEFAULT_MCP_URL,
  MCP_TOOL_PREFIX,
  isReadOnlyTool,
  tokenizeToolName,
} from '../../src/mcp/index.js';

/**
 * The read-only guarantee is the whole point of the MCP integration, so it is
 * tested as a property of our code rather than as a property of the server.
 * These tests run with no credentials and no network.
 */

describe('tool name tokenizer', () => {
  it('splits snake_case, camelCase and kebab-case identically', () => {
    expect(tokenizeToolName('describe_table')).toEqual(['describe', 'table']);
    expect(tokenizeToolName('describeTable')).toEqual(['describe', 'table']);
    expect(tokenizeToolName('describe-table')).toEqual(['describe', 'table']);
  });

  it('handles digits and repeated separators without producing empty tokens', () => {
    expect(tokenizeToolName('get__index2__stats')).toEqual(['get', 'index2', 'stats']);
  });
});

describe('read-only gate', () => {
  it('admits the schema-exploration tools the PRD asks for', () => {
    for (const name of [
      'list_databases',
      'describe_table',
      'show_indexes',
      'explain_query',
      'get_cluster_info',
      'listSchemas',
    ]) {
      expect(isReadOnlyTool(name), name).toEqual({ allowed: true });
    }
  });

  it('rejects every mutating verb', () => {
    for (const name of [
      'insert_row',
      'update_table',
      'delete_from',
      'drop_table',
      'truncate_table',
      'alter_column',
      'create_index',
      'grant_role',
      'run_sql',
      'execute_statement',
      'restore_backup',
    ]) {
      expect(isReadOnlyTool(name).allowed, name).toBe(false);
    }
  });

  it('DENY beats a server that annotates a destructive tool as read-only', () => {
    // The load-bearing test. A compromised or simply mis-annotated server must
    // not be able to talk us into calling DROP TABLE.
    const verdict = isReadOnlyTool('drop_table', { readOnlyHint: true });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/drop/);
  });

  it('rejects a tool the server flags destructive even with a benign name', () => {
    expect(isReadOnlyTool('table_maintenance', { destructiveHint: true }).allowed).toBe(false);
  });

  it('trusts an explicit readOnlyHint for a name it does not recognise', () => {
    expect(isReadOnlyTool('vector_index_recall_report', { readOnlyHint: true })).toEqual({
      allowed: true,
    });
  });

  it('fails closed on an unknown, unannotated tool', () => {
    // Neither allow-listed nor annotated. Dropping it costs a tool; admitting
    // it costs a guarantee.
    expect(isReadOnlyTool('frobnicate_widget').allowed).toBe(false);
    expect(isReadOnlyTool('').allowed).toBe(false);
  });
});

describe('CockroachMCPClient without credentials', () => {
  const saved = process.env.CRDB_MCP_API_KEY;

  afterEach(() => {
    if (saved === undefined) delete process.env.CRDB_MCP_API_KEY;
    else process.env.CRDB_MCP_API_KEY = saved;
  });

  it('reports unavailable rather than throwing, so the build never stops', async () => {
    delete process.env.CRDB_MCP_API_KEY;
    const result = await new CockroachMCPClient().connect();
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toMatch(/CRDB_MCP_API_KEY/);
    }
  });

  it('defaults to the managed server URL from the PRD', () => {
    expect(DEFAULT_MCP_URL).toBe('https://cockroachlabs.cloud/mcp');
  });

  it('exposes no tools and refuses calls while disconnected', async () => {
    const client = new CockroachMCPClient({ apiKey: undefined });
    expect(client.connected).toBe(false);
    expect(client.toolDefinitions()).toEqual([]);
    await expect(client.callTool('crdb_list_databases')).rejects.toThrow(/not connected/);
  });

  it('namespaces MCP tools so they cannot collide with the five PRD tools', () => {
    // `search_watchlist` is ours. An MCP server advertising the same name must
    // not shadow it in the agent's tool list.
    expect(MCP_TOOL_PREFIX).toBe('crdb_');
    expect(`${MCP_TOOL_PREFIX}search_watchlist`).not.toBe('search_watchlist');
  });

  it('closing an unconnected client is safe', async () => {
    await expect(new CockroachMCPClient().close()).resolves.toBeUndefined();
  });
});
