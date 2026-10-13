/**
 * Model Context Protocol (MCP) TypeScript types for RECSY.
 *
 * Implements the standard JSON-RPC 2.0 based MCP specification (2024-11-05),
 * exposing the Hybrid RAG pipeline and claim-level citation validation.
 */

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: Record<string, unknown>;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface McpToolProperty {
  readonly type: string;
  readonly description?: string;
  readonly items?: { readonly type: string };
  readonly default?: unknown;
}

export interface McpToolSchema {
  readonly type: 'object';
  readonly properties: Record<string, McpToolProperty>;
  readonly required?: readonly string[];
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpToolSchema;
}

export interface McpContentText {
  readonly type: 'text';
  readonly text: string;
}

export interface McpToolResult {
  readonly content: readonly McpContentText[];
  readonly isError?: boolean;
}
