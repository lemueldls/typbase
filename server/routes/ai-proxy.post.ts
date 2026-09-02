import type { AiConfig } from "@typbase/typing";

import { defineEventHandler, readBody, HTTPError } from "nitro/h3";

/**
 * CORS proxy for AI providers that block browsers. Self-host only: the
 * request body carries provider config and API keys, and this route has no
 * auth in dev. Do not deploy without restricting it (e.g. a shared secret).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    config?: AiConfig;
    keys?: { openai?: string; anthropic?: string };
    messages?: Array<{ role: string; content: string }>;
  }>(event);

  const config = body?.config;
  const messages = body?.messages;
  if (!config || !messages?.length) {
    throw new HTTPError("config and messages are required", {
      statusCode: 400,
    });
  }

  const target = config.baseUrl || "";
  if (!target) {
    throw new HTTPError("baseUrl is required", { statusCode: 400 });
  }

  const url =
    config.provider === "anthropic"
      ? `${target.replace(/\/$/, "")}/v1/messages`
      : config.provider === "ollama"
        ? `${target.replace(/\/$/, "")}/api/chat`
        : `${target.replace(/\/$/, "")}/chat/completions`;

  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      config.provider === "anthropic"
        ? { model: config.chatModel, max_tokens: 4096, messages }
        : config.provider === "ollama"
          ? { model: config.chatModel, messages, stream: false }
          : { model: config.chatModel, messages },
    ),
  };

  if (config.provider === "anthropic") {
    init.headers = {
      ...init.headers,
      "x-api-key": body.keys?.anthropic ?? "",
      "anthropic-version": "2023-06-01",
    };
  } else if (config.provider !== "ollama" && body.keys?.openai) {
    init.headers = {
      ...init.headers,
      authorization: `Bearer ${body.keys.openai}`,
    };
  }

  const response = await fetch(url, init);
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new HTTPError("Provider upstream failed", {
      statusCode: 502,
      data: json,
    });
  }

  let content = "";
  if (config.provider === "anthropic") {
    const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    content = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");
  } else if (config.provider === "ollama") {
    content = String((json?.message as { content?: unknown } | undefined)?.content ?? "");
  } else {
    const choice = (json?.choices as Array<{ message?: { content?: string } }> | undefined)?.[0];
    content = choice?.message?.content ?? "";
  }

  return { content };
});
