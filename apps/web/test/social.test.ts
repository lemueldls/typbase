import type { ThemePaletteTokens } from "@typbase/typing";

import { describe, expect, it } from "vitest";

import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  ogLocale,
  socialImageAlt,
  socialImagePath,
} from "../src/lib/site/social";

const palette = {
  surface: "#f9f9f8",
  surface2: "#f1f3f2",
  surface3: "#e7eae8",
  border: "#dbe0dd",
  borderStrong: "#c6ccc8",
  text: "#293133",
  textSecondary: "#66716f",
  accent: "#1f6f6b",
  accentSoft: "#e3e8e7",
  ok: "#3f704e",
  okSoft: "#e3e8e7",
  warning: "#8f6a13",
  warningSoft: "#ece8dd",
  danger: "#b3443e",
  dangerSoft: "#f1e3e2",
  info: "#2f6f9f",
  infoSoft: "#e1e8ed",
  red: "#b3443e",
  orange: "#a85c23",
  yellow: "#8f6a13",
  green: "#3f704e",
  cyan: "#2f6f9f",
  blue: "#2f6f9f",
  violet: "#6b538f",
  code: "#f1f4f2",
  overlay: "#000000cc",
} satisfies ThemePaletteTokens;

describe("social cards", () => {
  it("uses the standard card dimensions", () => {
    expect(OG_IMAGE_WIDTH).toBe(1200);
    expect(OG_IMAGE_HEIGHT).toBe(630);
  });

  it("builds readable alt text", () => {
    expect(socialImageAlt("Daily note", "My site")).toBe("Daily note · My site");
    expect(socialImageAlt("My site", "My site")).toBe("My site");
    expect(socialImageAlt("", "My site")).toBe("My site");
  });

  it("changes the image path when the page changes", () => {
    const first = socialImagePath("page-1", "Daily note", "One", "My site", palette);
    const second = socialImagePath("page-1", "Daily note", "Two", "My site", palette);
    const otherPalette = { ...palette, accent: "#ff0000" };
    const third = socialImagePath("page-1", "Daily note", "One", "My site", otherPalette);

    expect(first).toMatch(/^assets\/og\/daily-note-[0-9a-f]{8}\.png$/);
    expect(first).not.toBe(second);
    expect(first).not.toBe(third);
  });

  it("maps workspace locales to Open Graph locales", () => {
    expect(ogLocale("en")).toBe("en_US");
    expect(ogLocale("de")).toBe("de_DE");
    expect(ogLocale("pt-BR")).toBe("pt_BR");
  });
});
