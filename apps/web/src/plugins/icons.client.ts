/**
 * The Material Symbols woff2 is ~5 MB, so the 3 s block period from the
 * package's `font-display: block` can expire mid-download and the fallback
 * spells out the glyph name. `fonts.css` hides the ligature until this adds
 * `icons-ready` to the root element.
 *
 * Wait on the icon face only. `document.fonts.ready` would also wait for the
 * editor's text fonts, which enter use after the first page mounts.
 */
export default defineNuxtPlugin(() => {
  void document.fonts
    .load(`1em "Material Symbols Rounded"`)
    .catch(() => {
      // A font that never loads still has to reveal the fallback.
    })
    .then(() => {
      document.documentElement.classList.add("icons-ready");
    });
});
