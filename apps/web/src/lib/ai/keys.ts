/**
 * Provider API keys. These are device-local: they live in `local.json` and
 * never enter a Loro doc or a space record. The map is keyed by the provider
 * settings id, so adding or switching a provider does not drop a key.
 */

export type AiKeyState = Record<string, string>;

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

export function getAiKey(providerId: string): string {
  return state[providerId] ?? "";
}

export function setAiKey(providerId: string, key: string): void {
  state = { ...state, [providerId]: key };
  onWrite?.(state);
}
