import type { ThemeSeeds } from "@typbase/typing";

import {
  backdropFor,
  canonicalJson,
  contrastRatio,
  expandSeeds,
  parseThemeFile,
  settingsFromSkin,
  skinHash,
  skinToCssVars,
  validateSkin,
  validateThemeFile,
  type Skin,
} from "@typbase/skin";
import { DEFAULT_SETTINGS, THEME_SEED_KEYS } from "@typbase/typing";
import { describe, expect, it } from "vitest";

const seeds: ThemeSeeds = Object.fromEntries(
  THEME_SEED_KEYS.map((key) => [
    key,
    key === "surface"
      ? "#ffffff"
      : key === "text"
        ? "#111111"
        : key === "backdrop"
          ? "#dddddd"
          : "#777777",
  ]),
) as ThemeSeeds;

function fixtureSkin(): Skin {
  return {
    schema: "typbase.skin.v1",
    palette: {
      light: expandSeeds(seeds, "light"),
      dark: expandSeeds({ ...seeds, surface: "#111111", text: "#eeeeee" }, "dark"),
    },
    geometry: { size: "default", density: "default", radius: "default" },
    typography: {
      font: "Iosevka Concrete Text",
      mathFont: null,
      codeFont: null,
      textSize: 16,
      ligatures: true,
      kerning: true,
    },
  };
}

describe("skin schema", () => {
  it("accepts a complete skin", () => {
    const result = validateSkin(fixtureSkin());
    expect(result.ok).toBe(true);
    expect(result.value?.palette.light.surface).toBe("#ffffff");
  });

  it("rejects unknown fields and missing tokens", () => {
    const skin = fixtureSkin() as unknown as Record<string, unknown>;
    skin.extra = true;
    const palette = skin.palette as { light: Record<string, string> };
    delete palette.light.accent;

    const result = validateSkin(skin);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.path === "extra")).toBe(true);
    expect(result.errors.some((error) => error.path.includes("accent"))).toBe(true);
  });

  it("rejects a color the renderer cannot read", () => {
    const skin = fixtureSkin();
    skin.palette.light.accent = "hsl(180 50% 40%)";
    const result = validateSkin(skin);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.path.endsWith("accent"))).toBe(true);
  });

  it("warns when text contrast is too low", () => {
    const skin = fixtureSkin();
    skin.palette.light.text = "#fefefe";
    const result = validateSkin(skin);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.pair.includes("text on surface"))).toBe(true);
  });

  it("hashes canonically", async () => {
    const skin = fixtureSkin();
    const a = await skinHash(skin);
    const b = await skinHash(JSON.parse(JSON.stringify(skin)) as Skin);
    expect(a).toBe(b);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("maps removed bundled font families", () => {
    const skin = fixtureSkin();
    skin.typography.font = "Maple Mono";
    skin.typography.mathFont = "New Computer Modern Math";
    skin.typography.codeFont = null;

    const settings = settingsFromSkin(skin);
    expect(settings.font).toBe("Iosevka Concrete Text");
    expect(settings.mathFont).toBe("Concrete Math");
    expect(settings.codeFont).toBe("Iosevka Concrete Code");

    const vars = skinToCssVars(skin, "light");
    expect(vars["--font-sans"]).toContain("Iosevka Concrete Text");
    expect(vars["--font-mono"]).toContain("Iosevka Concrete Code");
    expect(vars["--font-math"]).toContain("Concrete Math");
  });

  it("writes CSS variables used by the app", () => {
    const vars = skinToCssVars(fixtureSkin(), "light");
    expect(vars["--color-surface"]).toBe("#ffffff");
    expect(vars["--ui-density"]).toBe("1");
    expect(vars["--color-backdrop"]).toBe("#dddddd");
    // A mid-gray solid is past the AA threshold for white, so black wins.
    expect(vars["--color-on-accent"]).toBe("#000000");
    expect(vars["--color-on-danger"]).toBe("#000000");
    expect(vars["--font-sans"]).toContain("Iosevka Concrete Text");
  });

  it("uses the page background for on-colors when it has enough contrast", () => {
    const skin = fixtureSkin();
    skin.palette.dark.danger = "#e28f87";

    const vars = skinToCssVars(skin, "dark");
    expect(vars["--color-on-danger"]).toBe("#111111");
  });

  it("derives a backdrop for skins written before the token", () => {
    const skin = fixtureSkin() as unknown as Record<string, unknown>;
    const palette = skin.palette as { light: Record<string, string> };
    delete palette.light.backdrop;

    const result = validateSkin(skin);
    expect(result.ok).toBe(true);
    expect(result.value?.palette.light.backdrop).toBe(
      backdropFor({ surface: "#ffffff", surface3: "#777777" }, "light"),
    );
  });

  it("maps a skin into workspace settings", () => {
    const patch = settingsFromSkin(fixtureSkin(), {
      source: "at://did/at.typbase.theme/test",
      version: "1.0.0",
    });
    expect(patch.themeName).toBe("custom");
    expect(patch.themeCustom?.light.surface).toBe("#ffffff");
    expect(patch.themeProvenance?.source).toBe("at://did/at.typbase.theme/test");
    expect(patch.themeProvenance?.modified).toBe(false);
  });

  it("round-trips the authoring file", () => {
    const file = {
      schema: "typbase.theme.v1",
      name: "Test",
      skin: fixtureSkin(),
    } as const;
    const verified = validateThemeFile(file);
    expect(verified.ok).toBe(true);
    expect(parseThemeFile(file).name).toBe("Test");
  });

  it("keeps the contrast helper honest", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 1);
  });
});

describe("workspace defaults", () => {
  it("has the provenance defaults", () => {
    expect(DEFAULT_SETTINGS.themeProvenance.source).toBeNull();
  });
});
