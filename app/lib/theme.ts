import { Rgb, ThemeColors } from "@typbase/wasm";

/** Neutral light palette, used when workspace settings do not define a theme. */
export function createDefaultTheme(): ThemeColors {
  return new ThemeColors(
    // background
    new Rgb(255, 255, 255),
    new Rgb(30, 30, 30),
    new Rgb(200, 200, 200),
    new Rgb(220, 220, 220),

    // primary
    new Rgb(30, 90, 160),
    new Rgb(255, 255, 255),
    new Rgb(220, 235, 250),
    new Rgb(20, 50, 80),

    // secondary
    new Rgb(40, 130, 90),
    new Rgb(255, 255, 255),
    new Rgb(215, 245, 228),
    new Rgb(15, 60, 40),

    // tertiary
    new Rgb(150, 80, 30),
    new Rgb(255, 255, 255),
    new Rgb(250, 228, 208),
    new Rgb(70, 35, 10),

    // error
    new Rgb(180, 40, 40),
    new Rgb(255, 255, 255),
    new Rgb(252, 224, 224),
    new Rgb(90, 15, 15),
  );
}
