# @typbase/engine

The Typst compiler and IDE engine for Typbase, compiled to WebAssembly.

- Paged and inline HTML rendering.
- Typst syntax, highlighting, hover, autocomplete, and diagnostics.
- Source maps from raw markup to the pristine synthesized document.
- Error recovery, delimiter repair, incremental frame partitioning, and the
  Typst package installer.
- PDF and SVG export.

This is the engine behind `@typbase/codemirror`. It is built with wasm-pack for
the web target.
