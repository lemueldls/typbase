# @typbase/plugin-sdk

The `.tbplugin` bundle format and the shared authoring validators.

- `createPluginBundle` / `parsePluginBundle`.
- `parseManifest`, `pluginSlug`, and `validatePatch`.
- `verifyPluginBundle`, `pluginBundleHash`.
- `HOST_COMPONENTS` and `unknownHostComponents`.

The app, registry, and CLI use the same manifest and bundle checks, so a plugin
that verifies outside the app installs the same way inside it.

JSON Schema for `plugin.json` lives in `schema/plugin.schema.json` and is served
at `https://typbase.at/schemas/plugin.json`.
