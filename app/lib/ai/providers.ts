import type { AiConfig } from "@typbase/typing";

/**
 * One interface, three drivers: OpenAI-compatible (covers most hosted
 * endpoints and Ollama's API compat layer), Anthropic, and native Ollama.
 * Provider config syncs in workspace settings; keys never do (they live in
 * local.json and are read by the caller on demand).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiProvider {
  chat(messages: ChatMessage[], options?: { temperature?: number }): Promise<string>;
}

export interface AiKeys {
  openai?: string;
  anthropic?: string;
}

export function createProvider(config: AiConfig, keys: AiKeys = {}): AiProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config.baseUrl, config.chatModel, keys.anthropic ?? "");
    case "ollama":
      return new OllamaProvider(config.baseUrl || "http://localhost:11434", config.chatModel);
    default:
      return new OpenAICompatibleProvider(
        config.baseUrl || "https://api.openai.com/v1",
        config.chatModel,
        keys.openai ?? "",
      );
  }
}

function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error(`Provider error (${response.status})`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

class OpenAICompatibleProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async chat(messages: ChatMessage[], options: { temperature?: number } = {}): Promise<string> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.4,
      }),
    });
    const body = await jsonResponse(response);
    const choice = (body.choices as Array<{ message?: { content?: string } }> | undefined)?.[0];

    return choice?.message?.content ?? "";
  }
}

class AnthropicProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async chat(messages: ChatMessage[], options: { temperature?: number } = {}): Promise<string> {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const rest = messages.filter((message) => message.role !== "system");

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        temperature: options.temperature ?? 0.4,
        ...(system ? { system } : {}),
        messages: rest.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
      }),
    });
    const body = await jsonResponse(response);
    const content = (body.content as Array<{ type?: string; text?: string }> | undefined) ?? [];

    return content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");
  }
}

class OllamaProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async chat(messages: ChatMessage[], options: { temperature?: number } = {}): Promise<string> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: { temperature: options.temperature ?? 0.4 },
      }),
    });
    const body = await jsonResponse(response);

    return String(body.message ? ((body.message as { content?: unknown }).content ?? "") : "");
  }
}

/**
 * CORS-proxied chat for providers that block browsers. The Nitro route
 * `server/routes/ai-proxy.post.ts` forwards to the given base URL; only run
 * it on a host you control (self-host-only).
 */
export async function chatThroughProxy(
  proxyUrl: string,
  config: AiConfig,
  keys: AiKeys,
  messages: ChatMessage[],
): Promise<string> {
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config, keys, messages }),
  });
  const body = (await response.json().catch(() => null)) as {
    content?: string;
    error?: string;
  } | null;
  if (!response.ok) throw new Error(body?.error ?? `Proxy error (${response.status})`);

  return body?.content ?? "";
}
