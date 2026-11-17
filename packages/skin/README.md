# @typbase/skin

The typed theme contract for Typbase.

- `SKIN_SCHEMA_VERSION` and the `Skin` type.
- `validateSkin` / `parseSkin` and `validateThemeFile` / `parseThemeFile`.
- `canonicalJson` and `skinHash`.
- `contrastRatio` and `contrastWarnings`.
- `previewPalette`, `skinToCssVars`, `settingsFromSkin`, `skinFromSettings`.
- The color math used by the app and the published site (`expandSeeds`,
  `normalizeCssColor`, `mixHex`).

A skin has two complete palettes, geometry, and typography. It has no CSS,
fonts, images, or Typst source. Palettes include `backdrop`, the plane behind
the page islands. Skins written before that token still validate; the validator
derives one from `surface` and `surface3`.

JSON Schemas live in `schema/` and are served by the app at
`https://typbase.at/schemas/`.
