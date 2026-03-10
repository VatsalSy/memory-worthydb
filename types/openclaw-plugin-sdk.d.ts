declare module "openclaw/plugin-sdk" {
  export type PluginLogger = {
    debug?: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };

  export type PluginConfigUiHint = {
    label?: string;
    help?: string;
    tags?: string[];
    advanced?: boolean;
    sensitive?: boolean;
    placeholder?: string;
  };

  export type OpenClawPluginConfigSchema = {
    safeParse?: (value: unknown) => {
      success: boolean;
      data?: unknown;
      error?: {
        issues?: Array<{ path: Array<string | number>; message: string }>;
      };
    };
    parse?: (value: unknown) => unknown;
    validate?: (value: unknown) => {
      ok: boolean;
      value?: unknown;
      errors?: string[];
    };
    uiHints?: Record<string, PluginConfigUiHint>;
    jsonSchema?: Record<string, unknown>;
  };

  export type OpenClawPluginToolContext = {
    config?: unknown;
    workspaceDir?: string;
    agentDir?: string;
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    messageChannel?: string;
    agentAccountId?: string;
    requesterSenderId?: string;
    senderIsOwner?: boolean;
    sandboxed?: boolean;
  };

  export type ToolContentPart = {
    type: string;
    text?: string;
    [key: string]: unknown;
  };

  export type AnyAgentTool = {
    name: string;
    label?: string;
    description?: string;
    parameters?: unknown;
    execute: (
      toolCallId: string,
      params: unknown,
    ) =>
      | Promise<{ content: ToolContentPart[]; details?: unknown }>
      | { content: ToolContentPart[]; details?: unknown };
  };

  export type OpenClawPluginToolFactory = (
    ctx: OpenClawPluginToolContext,
  ) => AnyAgentTool | AnyAgentTool[] | null | undefined;

  export type PluginHookAgentContext = {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    workspaceDir?: string;
    messageProvider?: string;
    trigger?: string;
    channelId?: string;
  };

  export type PluginHookName =
    | "before_model_resolve"
    | "before_prompt_build"
    | "before_agent_start"
    | "agent_end";

  export type PluginHookHandlerMap = {
    before_model_resolve: (
      event: { prompt: string },
      ctx: PluginHookAgentContext,
    ) =>
      | void
      | { modelOverride?: string; providerOverride?: string }
      | Promise<void | { modelOverride?: string; providerOverride?: string }>;
    before_prompt_build: (
      event: { prompt: string; messages: unknown[] },
      ctx: PluginHookAgentContext,
    ) =>
      | void
      | {
          systemPrompt?: string;
          prependContext?: string;
          prependSystemContext?: string;
          appendSystemContext?: string;
        }
      | Promise<
          | void
          | {
              systemPrompt?: string;
              prependContext?: string;
              prependSystemContext?: string;
              appendSystemContext?: string;
            }
        >;
    before_agent_start: (
      event: { prompt: string; messages?: unknown[] },
      ctx: PluginHookAgentContext,
    ) =>
      | void
      | {
          prependContext?: string;
          systemPrompt?: string;
          prependSystemContext?: string;
          appendSystemContext?: string;
          modelOverride?: string;
          providerOverride?: string;
        }
      | Promise<
          | void
          | {
              prependContext?: string;
              systemPrompt?: string;
              prependSystemContext?: string;
              appendSystemContext?: string;
              modelOverride?: string;
              providerOverride?: string;
            }
        >;
    agent_end: (
      event: { messages: unknown[]; success: boolean; error?: string; durationMs?: number },
      ctx: PluginHookAgentContext,
    ) => void | Promise<void>;
  };

  export type OpenClawPluginApi = {
    id: string;
    name: string;
    version?: string;
    description?: string;
    source: string;
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    runtime: Record<string, unknown>;
    logger: PluginLogger;
    registerTool: (
      tool: AnyAgentTool | OpenClawPluginToolFactory,
      opts?: { name?: string; names?: string[]; optional?: boolean },
    ) => void;
    registerCli: (registrar: (ctx: { program: any }) => void, opts?: { commands?: string[] }) => void;
    registerService: (service: {
      id: string;
      start?: () => void | Promise<void>;
      stop?: () => void | Promise<void>;
    }) => void;
    resolvePath: (input: string) => string;
    on: <K extends PluginHookName>(
      hookName: K,
      handler: PluginHookHandlerMap[K],
      opts?: { priority?: number },
    ) => void;
  };

  export function emptyPluginConfigSchema(): OpenClawPluginConfigSchema;
}
