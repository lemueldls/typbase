import { describe, expect, it } from "vitest";

import { useConfirm } from "../src/composables/confirm";

describe("useConfirm", () => {
  it("resolves true when the request is confirmed", async () => {
    const { open, confirm, settle } = useConfirm();

    const answer = confirm({ title: "Delete page?" });
    expect(open.value).toBe(true);

    settle(true);

    await expect(answer).resolves.toBe(true);
    expect(open.value).toBe(false);
  });

  it("resolves false when the dialog closes without confirming", async () => {
    const { confirm, settle } = useConfirm();

    const answer = confirm({ title: "Delete page?" });
    settle(false);

    await expect(answer).resolves.toBe(false);
  });

  it("cancels the previous request when another one opens", async () => {
    const { confirm, settle } = useConfirm();

    const first = confirm({ title: "Delete page?" });
    const second = confirm({ title: "Delete workspace?" });

    await expect(first).resolves.toBe(false);

    settle(true);
    await expect(second).resolves.toBe(true);
  });
});
