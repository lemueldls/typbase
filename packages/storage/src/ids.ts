import { init } from "@paralleldrive/cuid2";

/**
 * Page, plugin, chat, message, and workspace ids. Eight characters: about two
 * million ids before a 50% birthday collision, and every caller passes the ids
 * its scope already holds, so a hit costs one more draw instead of a merged
 * document. The ids are not secrets, so length only buys collision room.
 */
const candidate = init({ length: 8 });

export function createId(taken?: (id: string) => boolean): string {
  for (;;) {
    const id = candidate();
    if (!taken?.(id)) return id;
  }
}
