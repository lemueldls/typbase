import { afterEach, describe, expect, it } from "vitest";

import {
  installedFontPackIds,
  installedPacksForText,
  packsForScripts,
  scriptsInText,
} from "../src/lib/fontPacks";

describe("font pack scripts", () => {
  afterEach(() => {
    installedFontPackIds.value = [];
  });

  it("finds the scripts a page uses", () => {
    expect(scriptsInText("plain ascii")).toEqual([]);
    expect(scriptsInText("你好")).toContain("Hani");
    expect(scriptsInText("，")).toContain("Hani");
    expect(scriptsInText("こんにちは世界")).toEqual(expect.arrayContaining(["Hani", "Hira"]));
    expect(scriptsInText("한글")).toContain("Hang");
    expect(scriptsInText("Привет")).toEqual([]);
    expect(scriptsInText("😀")).toContain("Emoji");
  });

  it("keeps CJK packs in the chooser for Han text", () => {
    const packs = packsForScripts(["Hani"]);

    expect(packs.map((pack) => pack.id)).toEqual(["cjk-sc", "cjk-tc", "cjk-jp", "cjk-kr"]);
  });

  it("prefers the Japanese face when kana are present", () => {
    expect(packsForScripts(["Hani", "Hira"])[0]?.id).toBe("cjk-jp");
  });

  it("offers only Hangul-capable faces for Korean", () => {
    expect(packsForScripts(["Hani", "Hang"]).map((pack) => pack.id)).toEqual(["cjk-kr"]);
  });

  it("falls back to every overlapping pack when none covers all scripts", () => {
    const ids = packsForScripts(["Hani", "Arab"]).map((pack) => pack.id);

    expect(ids).toContain("cjk-sc");
    expect(ids).toContain("arabic");
    expect(ids).not.toContain("emoji");
  });

  it("lists every pack when no script is passed", () => {
    expect(packsForScripts([]).length).toBeGreaterThan(4);
  });

  it("picks installed packs for an export by the source scripts", () => {
    installedFontPackIds.value = ["cjk-jp", "arabic"];

    expect(installedPacksForText("日本語のページ").map((pack) => pack.id)).toEqual(["cjk-jp"]);
    expect(installedPacksForText("العربية").map((pack) => pack.id)).toEqual(["arabic"]);
    expect(installedPacksForText("plain ascii")).toEqual([]);
  });
});
