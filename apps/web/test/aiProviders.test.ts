import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProvider,
  readLines,
  type AiStreamEvent,
  type ProviderMessage,
} from "../src/lib/ai/providers";

/**
 * Provider stream parsing. These are the adapters' edge cases: fragmented
 * tool-call JSON, chunk boundaries in the middle of a line, and the three
 * wire formats. A fake fetch returns a scripted body.
 */

function streamResponse(chunks: string[], contentType = "text/event-stream"): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

async function collect(events: AsyncIterable<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = [];
  for await (const event of events) out.push(event);

  return out;
}

function request(messages: ProviderMessage[] = [{ role: "user", content: "hi" }]) {
  return {
    messages,
    model: "test-model",
    signal: new AbortController().signal,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readLines", () => {
  it("reassembles lines split across chunks", async () => {
    const response = streamResponse(["one\ntw", "o\nth", "ree"]);
    const lines: string[] = [];
    for await (const line of readLines(response.body!)) lines.push(line);

    expect(lines).toEqual(["one", "two", "three"]);
  });

  it("strips carriage returns", async () => {
    const response = streamResponse(["\r\n"]);
    const lines: string[] = [];
    for await (const line of readLines(response.body!)) lines.push(line);

    expect(lines).toEqual([""]);
  });
});

describe("openai-compatible provider", () => {
  it("streams text and assembles fragmented tool calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          sse({ choices: [{ delta: { content: "Hel" } }] }),
          sse({ choices: [{ delta: { content: "lo" } }] }),
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: { name: "search_notes", arguments: '{"qu' },
                    },
                  ],
                },
              },
            ],
          }),
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: 'ery":"x"}' } }],
                },
              },
            ],
          }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const provider = createProvider(
      {
        id: "test",
        name: "test",
        kind: "openai-compatible",
        baseUrl: "http://example.test/v1",
        model: "test-model",
      },
      "key",
    );
    const events = await collect(provider.stream(request()));

    const text = events
      .filter((event) => event.type === "text")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(text).toBe("Hello");

    const tool = events.find((event) => event.type === "tool");
    expect(tool).toMatchObject({
      call: { id: "call_1", name: "search_notes", input: { query: "x" } },
    });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("surfaces provider errors with the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad key", { status: 401 })),
    );

    const provider = createProvider({
      id: "test",
      name: "test",
      kind: "openai-compatible",
      baseUrl: "http://example.test/v1",
      model: "test-model",
    });

    await expect(collect(provider.stream(request()))).rejects.toThrow("401");
  });
});

describe("anthropic provider", () => {
  it("streams text and accumulates tool input JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          sse({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
          sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }),
          sse({
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id: "tool_1", name: "read_note" },
          }),
          sse({
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: '{"pageId"' },
          }),
          sse({
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: ':"abc"}' },
          }),
          sse({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
        ]),
      ),
    );

    const provider = createProvider({
      id: "test",
      name: "test",
      kind: "anthropic",
      baseUrl: "http://example.test",
      model: "test-model",
    });
    const events = await collect(provider.stream(request()));

    expect(events[0]).toEqual({ type: "text", text: "Hi" });
    expect(events.find((event) => event.type === "tool")).toMatchObject({
      call: { id: "tool_1", name: "read_note", input: { pageId: "abc" } },
    });
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "tool_use" });
  });
});

describe("ollama provider", () => {
  it("streams NDJSON content and final tool calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse(
          [
            `${JSON.stringify({ message: { content: "He" } })}\n`,
            `${JSON.stringify({ message: { content: "y" } })}\n`,
            `${JSON.stringify({
              message: {
                content: "",
                tool_calls: [{ function: { name: "list_notes", arguments: {} } }],
              },
              done: true,
              done_reason: "stop",
            })}\n`,
          ],
          "application/x-ndjson",
        ),
      ),
    );

    const provider = createProvider({
      id: "test",
      name: "test",
      kind: "ollama",
      baseUrl: "http://example.test",
      model: "test-model",
    });
    const events = await collect(provider.stream(request()));

    const text = events
      .filter((event) => event.type === "text")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(text).toBe("Hey");
    expect(events.find((event) => event.type === "tool")).toMatchObject({
      call: { name: "list_notes" },
    });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
});
