import { init } from "@paralleldrive/cuid2";

const candidate = init({ length: 16 });

export function createId(taken?: (id: string) => boolean): string {
  for (;;) {
    const id = candidate();
    if (!taken?.(id)) return id;
  }
}
