import type { AiProviderKind, AiProviderSettings } from "@typbase/typing";

/**
 * Streaming chat providers. Every adapter speaks the same shape: a request of
 * messages plus optional tools, and an async iterable of text deltas, tool
 * calls, and a final done event. Nothing buffers the whole reply, because the
 * chat pane renders (and validates) while tokens arrive.
 *
 * The browser talks to providers directly. Anthropic needs the
 * `anthropic-dangerous-direct-browser-access` header for that; Ollama needs
 * its origin allowed (`OLLAMA_ORIGINS`). A custom OpenAI-compatible endpoint
 * needs CORS.
 */

export interface ProviderToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Tool calls an assistant turn requested. */
  toolCalls?: ProviderToolCall[];
  /** The call a tool result answers. Anthropic requires it; others ignore it. */
  toolCallId?: string;
  /** Tool name for tool results (Ollama). */
  name?: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object for the tool input. */
  parameters: Record<string, unknown>;
}

export type AiStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; call: ProviderToolCall }
  | { type: "done"; stopReason: string | null };

export interface AiStreamRequest {
  messages: ProviderMessage[];
  model: string;
  tools?: AiToolDefinition[];
  signal: AbortSignal;
  temperature?: number;
}

export interface AiProvider {
  stream(request: AiStreamRequest): AsyncIterable<AiStreamEvent>;
}

const DEFAULT_BASE_URLS: Record<AiProviderKind, string> = {
  "openai-compatible": "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  ollama: "http://localhost:11434",
};

export function providerBaseUrl(config: AiProviderSettings): string {
  return (config.baseUrl.trim() || DEFAULT_BASE_URLS[config.kind]).replace(/\/$/, "");
}

export function createProvider(config: AiProviderSettings, apiKey = ""): AiProvider {
  switch (config.kind) {
    case "anthropic":
      return new AnthropicProvider(providerBaseUrl(config), apiKey);
    case "ollama":
      return new OllamaProvider(providerBaseUrl(config));
    default:
      return new OpenAICompatibleProvider(providerBaseUrl(config), apiKey);
  }
}

/** One line at a time out of a streaming fetch body. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const index = buffer.indexOf("\n");
        if (index < 0) break;
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        yield line;
      }
    }

    buffer += decoder.decode();
    if (buffer.length) yield buffer.replace(/\r$/, "");
  } finally {
    reader.releaseLock();
  }
}

async function providerError(response: Response): Promise<Error> {
  const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);

  return new Error(`Provider error (${response.status})${detail ? `: ${detail}` : ""}`);
}

function randomId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `call-${Math.random().toString(36).slice(2)}`;
}

class OpenAICompatibleProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async *stream(request: AiStreamRequest): AsyncIterable<AiStreamEvent> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: request.model,
        stream: true,
        temperature: request.temperature ?? 0.4,
        messages: request.messages.map(toOpenAiMessage),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: "auto",
            }
          : {}),
      }),
      signal: request.signal,
    });
    if (!response.ok) throw await providerError(response);
    if (!response.body) throw new Error("Provider returned no stream");

    // Tool call deltas arrive fragmented across chunks; keyed by the stream's
    // own index, arguments concatenate until the call is complete.
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let stopReason: string | null = null;

    for await (const line of readLines(response.body)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
      if (!choice) continue;
      const delta = (choice.delta ?? {}) as Record<string, unknown>;

      if (typeof delta.content === "string" && delta.content) {
        yield { type: "text", text: delta.content };
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const raw of delta.tool_calls as Array<Record<string, unknown>>) {
          const index = typeof raw.index === "number" ? raw.index : 0;
          const entry = calls.get(index) ?? { id: "", name: "", args: "" };
          if (typeof raw.id === "string") entry.id = raw.id;
          const fn = (raw.function ?? {}) as Record<string, unknown>;
          if (typeof fn.name === "string") entry.name += fn.name;
          if (typeof fn.arguments === "string") entry.args += fn.arguments;
          calls.set(index, entry);
        }
      }

      if (typeof choice.finish_reason === "string") stopReason = choice.finish_reason;
    }

    for (const entry of calls.values()) {
      if (!entry.name) continue;
      yield { type: "tool", call: toolCall(entry.id, entry.name, entry.args) };
    }

    yield { type: "done", stopReason };
  }
}

function toOpenAiMessage(message: ProviderMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", content: message.content, tool_call_id: message.toolCallId ?? "" };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
      })),
    };
  }

  return { role: message.role, content: message.content };
}

function toolCall(id: string, name: string, args: string): ProviderToolCall {
  let input: unknown = {};
  if (args) {
    try {
      input = JSON.parse(args) as unknown;
    } catch {
      input = { raw: args };
    }
  }

  return { id: id || randomId(), name, input };
}

class AnthropicProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async *stream(request: AiStreamRequest): AsyncIterable<AiStreamEvent> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        // Without this the API refuses requests from a browser origin.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 8192,
        stream: true,
        temperature: request.temperature ?? 0.4,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(request.messages),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
      }),
      signal: request.signal,
    });
    if (!response.ok) throw await providerError(response);
    if (!response.body) throw new Error("Provider returned no stream");

    // Tool inputs stream as partial JSON per content block index.
    const blocks = new Map<number, { id: string; name: string; json: string }>();
    let stopReason: string | null = null;

    for await (const line of readLines(response.body)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = event.type;
      if (type === "content_block_start") {
        const index = typeof event.index === "number" ? event.index : 0;
        const block = (event.content_block ?? {}) as Record<string, unknown>;
        if (block.type === "tool_use") {
          blocks.set(index, {
            id: typeof block.id === "string" ? block.id : randomId(),
            name: typeof block.name === "string" ? block.name : "",
            json: "",
          });
        }
        continue;
      }

      if (type === "content_block_delta") {
        const index = typeof event.index === "number" ? event.index : 0;
        const delta = (event.delta ?? {}) as Record<string, unknown>;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          yield { type: "text", text: delta.text };
        } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const entry = blocks.get(index);
          if (entry) entry.json += delta.partial_json;
        }
        continue;
      }

      if (type === "message_delta") {
        const delta = (event.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.stop_reason === "string") stopReason = delta.stop_reason;
      }
    }

    for (const entry of blocks.values()) {
      if (!entry.name) continue;
      yield { type: "tool", call: toolCall(entry.id, entry.name, entry.json) };
    }

    yield { type: "done", stopReason };
  }
}

function toAnthropicMessages(messages: ProviderMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "tool") {
      const result = {
        type: "tool_result",
        tool_use_id: message.toolCallId ?? "",
        content: message.content,
      };
      const last = out.at(-1);
      // Tool results ride the user turn right after the assistant's tool_use.
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(result);
      } else {
        out.push({ role: "user", content: [result] });
      }
      continue;
    }

    if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input ?? {} });
      }
      if (!content.length) content.push({ type: "text", text: "" });
      out.push({ role: "assistant", content });
      continue;
    }

    out.push({ role: "user", content: message.content });
  }

  return out;
}

class OllamaProvider implements AiProvider {
  constructor(private readonly baseUrl: string) {}

  async *stream(request: AiStreamRequest): AsyncIterable<AiStreamEvent> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        stream: true,
        messages: request.messages.map(toOllamaMessage),
        options: { temperature: request.temperature ?? 0.4 },
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }
          : {}),
      }),
      signal: request.signal,
    });
    if (!response.ok) throw await providerError(response);
    if (!response.body) throw new Error("Provider returned no stream");

    let stopReason: string | null = null;

    for await (const line of readLines(response.body)) {
      if (!line.trim()) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      const message = (parsed.message ?? {}) as Record<string, unknown>;
      if (typeof message.content === "string" && message.content) {
        yield { type: "text", text: message.content };
      }

      if (Array.isArray(message.tool_calls)) {
        for (const raw of message.tool_calls as Array<Record<string, unknown>>) {
          const fn = (raw.function ?? {}) as Record<string, unknown>;
          const name = typeof fn.name === "string" ? fn.name : "";
          if (!name) continue;
          const args =
            typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments);
          yield {
            type: "tool",
            call: { id: randomId(), name, input: safeJson(args) },
          };
        }
      }

      if (parsed.done === true) {
        if (typeof parsed.done_reason === "string") stopReason = parsed.done_reason;
        break;
      }
    }

    yield { type: "done", stopReason };
  }
}

function safeJson(text: string): unknown {
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function toOllamaMessage(message: ProviderMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      ...(message.name ? { tool_name: message.name } : {}),
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        function: { name: call.name, arguments: call.input ?? {} },
      })),
    };
  }

  return { role: message.role, content: message.content };
}
