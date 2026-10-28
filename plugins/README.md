# First-party plugins

The calendar and drawing plugins ship with Typbase by default so a fresh
workspace works offline. They are ordinary plugin folders and can be forked in
the studio, then published to the same registry as community plugins.

The app imports these sources at build time. Keeping them in a dedicated
plugins directory separates first-party plugin authoring from the web app
while still bundling a pinned copy.
