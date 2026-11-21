# Bundled fonts

The app ships these families for the Concrete look:

| Role | Family                  | Source                    |
| ---- | ----------------------- | ------------------------- |
| Text | `Iosevka Concrete Text` | custom quasi-proportional |
| Math | `Concrete Math`         | concmath-otf              |
| Code | `Iosevka Concrete Code` | custom monospaced         |

`concrete-math/` documents the unmodified math files. `iosevka/` holds the build
plans and the script that regenerates the four text faces and the four code
faces. Both Iosevka builds use a 600 unit width. Their italics use named motion
variants and flat tails; x/r/z/y stay at the slab defaults.

The mono keeps Iosevka's native `calt` code ligatures, so they are always on
in Typst and the editor. The workspace Ligatures switch covers prose `liga` and
`clig` only. The text face has no code ligatures.

```bash
pnpm fonts:iosevka
```

The generated TTFs, manifests, and OFL licenses live in
`apps/web/public/fonts/code/` and `apps/web/public/fonts/text/`.
