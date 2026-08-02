import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolDef } from '../providers/types.js';
import { isReadOnlyTool, type ToolAnnotations } from './readonly.js';

/**
 * Client for the CockroachDB Cloud Managed MCP Server.
 *
 * The agent's five PRD tools are hand-written against our own schema. This is
 * the other direction: the database describes *itself* to the agent, so an
 * analyst can ask "what else does this cluster know about this counterparty"
 * without someone first writing a tool for it.
 *
 * Everything here is read-only. See `readonly.ts` — the guarantee is enforced
 * on this side, not taken on trust from the server.
 *
 * Absent credentials this module is inert: `connect()` reports `unavailable`
 * rather than throwing, and the agent runs with its five built-in tools. That
 * is the documented degradation path, not a silent failure.
 */

export const DEFAULT_MCP_URL = 'https://cockroachlabs.cloud/mcp';

/** Namespace for MCP tools, so they can never collide with the PRD five. */
export const MCP_TOOL_PREFIX = 'crdb_';

export interface MCPTool {
  /** Name as exposed to the agent, e.g. `crdb_describe_table`. */
  name: string;
  /** Name on the wire, as the server declared it. */
  remoteName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPRejectedTool {
  remoteName: string;
  reason: string;
}

export type MCPConnectResult =
  | { status: 'connected'; tools: MCPTool[]; rejected: MCPRejectedTool[] }
  | { status: 'unavailable'; reason: string };

export interface CockroachMCPOptions {
  url?: string;
  apiKey?: string;
  /** Which cluster the server should act against. */
  clusterId?: string;
  /** Client identity sent on initialize. */
  clientName?: string;
}

export class CockroachMCPClient {
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly clusterId: string | undefined;
  private readonly clientName: string;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private tools = new Map<string, MCPTool>();

  constructor(options: CockroachMCPOptions = {}) {
    this.url = options.url ?? process.env.CRDB_MCP_URL ?? DEFAULT_MCP_URL;
    this.apiKey = options.apiKey ?? process.env.CRDB_MCP_API_KEY;
    this.clusterId = options.clusterId ?? process.env.CRDB_MCP_CLUSTER_ID;
    this.clientName = options.clientName ?? 'sifta';
  }

  get connected(): boolean {
    return this.client !== null;
  }

  /**
   * Connect and discover tools.
   *
   * Never throws on a missing credential or an unreachable server — those are
   * expected states with a defined fallback, and the build must not stop for
   * them. A malformed URL is different, and does throw.
   */
  async connect(): Promise<MCPConnectResult> {
    if (!this.apiKey) {
      return {
        status: 'unavailable',
        reason:
          'CRDB_MCP_API_KEY is not set. The agent runs with its five built-in tools; ' +
          'set a CockroachDB Cloud API key to enable schema exploration.',
      };
    }

    const url = new URL(this.url);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          // The server needs to be told which cluster to act against. This is
          // the header CockroachDB Cloud's own Connect dialog hands out, and
          // without it the connection has no target.
          ...(this.clusterId ? { 'mcp-cluster-id': this.clusterId } : {}),
        },
      },
    });

    const client = new Client(
      { name: this.clientName, version: '0.1.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
    } catch (err) {
      await safeClose(transport);
      return {
        status: 'unavailable',
        reason: `could not connect to ${this.url}: ${errorMessage(err)}`,
      };
    }

    this.client = client;
    this.transport = transport;

    try {
      const { tools, rejected } = await this.discover();
      return { status: 'connected', tools, rejected };
    } catch (err) {
      await this.close();
      return {
        status: 'unavailable',
        reason: `connected but tool discovery failed: ${errorMessage(err)}`,
      };
    }
  }

  private async discover(): Promise<{ tools: MCPTool[]; rejected: MCPRejectedTool[] }> {
    const client = this.requireClient();
    const listed = await client.listTools();

    const tools: MCPTool[] = [];
    const rejected: MCPRejectedTool[] = [];

    for (const tool of listed.tools) {
      const verdict = isReadOnlyTool(tool.name, tool.annotations as ToolAnnotations | undefined);
      if (!verdict.allowed) {
        rejected.push({ remoteName: tool.name, reason: verdict.reason });
        continue;
      }
      const exposed: MCPTool = {
        name: `${MCP_TOOL_PREFIX}${tool.name}`,
        remoteName: tool.name,
        description: tool.description ?? `CockroachDB MCP tool '${tool.name}'.`,
        inputSchema: (tool.inputSchema as Record<string, unknown> | undefined) ?? {
          type: 'object',
          properties: {},
        },
      };
      tools.push(exposed);
      this.tools.set(exposed.name, exposed);
    }

    return { tools, rejected };
  }

  /** The discovered tools in the shape the agent loop's LLMProvider expects. */
  toolDefinitions(): ToolDef[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description:
        `${tool.description}\n\nRead-only schema exploration against the ` +
        `CockroachDB cluster. Cannot modify data.`,
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * Execute a discovered tool.
   *
   * The read-only gate is re-applied here rather than relying on the fact that
   * discovery already filtered. The name arriving at this function was chosen
   * by a language model, and `tools` is a map that a future refactor could
   * populate from somewhere less careful.
   */
  async callTool(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
    const client = this.requireClient();
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(
        `'${name}' is not an available CockroachDB MCP tool. Available: ` +
          `${[...this.tools.keys()].join(', ') || '(none)'}`,
      );
    }

    const verdict = isReadOnlyTool(tool.remoteName);
    if (!verdict.allowed) {
      throw new Error(`refusing to call '${tool.remoteName}': ${verdict.reason}`);
    }

    const result = await client.callTool({ name: tool.remoteName, arguments: input });
    if (result.isError) {
      throw new Error(`MCP tool '${tool.remoteName}' failed: ${JSON.stringify(result.content)}`);
    }
    return result.content;
  }

  async close(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.tools.clear();
    if (client) {
      try {
        await client.close();
        return;
      } catch {
        // Fall through to closing the transport directly.
      }
    }
    if (transport) await safeClose(transport);
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error('CockroachMCPClient is not connected. Call connect() first.');
    }
    return this.client;
  }
}

async function safeClose(transport: StreamableHTTPClientTransport): Promise<void> {
  try {
    await transport.close();
  } catch {
    // Closing a transport that never opened is not an error worth surfacing.
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
