/**
 * AI keys live in local.json (via the workspace composable), never in Loro
 * or spaces. Read on demand at request time so a change applies to the next
 * generation without a restart.
 */
export interface AiKeyState {
  openai?: string;
  anthropic?: string;
}

let state: AiKeyState = {};
let onWrite: ((keys: AiKeyState) => void) | undefined;

/** Called once at app start with the persisted keys. */
export function initAiKeys(keys: AiKeyState, writer?: (keys: AiKeyState) => void): void {
  state = keys ?? {};
  onWrite = writer;
}

export function getAiKeys(): AiKeyState {
  return state;
}

export function setAiKeys(keys: AiKeyState): void {
  state = keys;
  onWrite?.(keys);
}
