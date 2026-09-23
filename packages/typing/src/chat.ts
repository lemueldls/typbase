/**
 * Chat types. A thread is one conversation with a model; messages are the
 * turns. Chat threads live in the workspace like pages and plugins: a `chats`
 * map in the workspace doc plus one Loro doc per thread, so they are
 * local-first and sync through the same registry.
 *
 * Only assistant messages carry Typst source. Everything a model writes is
 * compiled by the engine before it counts as verified, which is what the
 * status and diagnostics fields record.
 */

/** Who wrote a message. Only "assistant" turns hold model output. */
export type ChatRole = "user" | "assistant";

/**
 * Lifecycle of a model turn:
 * - `streaming`: tokens are still arriving;
 * - `verifying`: the stream ended and the engine is compiling the result;
 * - `repairing`: a compile failed and a repair turn is in flight;
 * - `verified`: the pristine compile had no errors;
 * - `unverified`: the compile still failed after the repair budget;
 * - `aborted`: the user stopped the stream;
 * - `error`: the provider or the engine failed before verification.
 */
export type ChatMessageStatus =
  | "streaming"
  | "verifying"
  | "repairing"
  | "verified"
  | "unverified"
  | "aborted"
  | "error";

/** A compile problem attached to a message, in raw source offsets. */
export interface ChatDiagnostic {
  severity: "error" | "warning";
  message: string;
  /** UTF-16 offsets into `source`. */
  start: number;
  end: number;
  hints: string[];
}

/** One agentic tool call the model made while composing a reply. */
export interface ChatToolRun {
  id: string;
  name: string;
  /** JSON-encoded tool input, as stored in the doc. */
  input: string;
  /** Truncated result text shown in the thread. */
  output: string;
  at: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Position in the thread; ascending. Gaps are fine after deletions. */
  seq: number;
  /** Model output is Typst; user messages are plain text. */
  source: string;
  status: ChatMessageStatus;
  /** Provider settings id the turn used, when an assistant wrote it. */
  providerId: string | null;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  /** A repair turn points at the message whose errors it fixes. */
  repairOf: string | null;
  /** Problems from the last verification pass; empty when verified. */
  diagnostics: ChatDiagnostic[];
  /** Tool calls made before or during the reply. */
  tools: ChatToolRun[];
  /** Human-readable provider/engine failure, when there is one. */
  error: string | null;
}

export interface ChatThread {
  id: string;
  title: string;
  /** Provider used by default in this thread; null follows workspace default. */
  providerId: string | null;
  /** Model id used by default in this thread; null follows provider config. */
  model: string | null;
  /** Page captured as context when the thread was created. */
  pageId: string | null;
  createdAt: number;
  updatedAt: number;
}
