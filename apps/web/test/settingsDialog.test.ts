import { describe, expect, it } from "vitest";

import { useSettingsDialog } from "../src/composables/settingsDialog";

describe("useSettingsDialog", () => {
  it("opens on a requested tab", () => {
    const dialog = useSettingsDialog();

    dialog.hide();
    dialog.show("sync");

    expect(dialog.open.value).toBe(true);
    expect(dialog.tab.value).toBe("sync");

    dialog.hide();
  });
});
