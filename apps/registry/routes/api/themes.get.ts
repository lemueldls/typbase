import { defineHandler } from "nitro";

import { registryCatalog } from "../../lib/catalog";

export default defineHandler(async () => {
  const catalog = await registryCatalog();

  return {
    publishers: catalog.publishers,
    warnings: catalog.warnings,
    themes: catalog.themes.map((entry) => ({
      uri: entry.uri,
      publisher: entry.publisher,
      name: entry.listing.name,
      description: entry.listing.description ?? "",
      tags: entry.listing.tags ?? [],
      license: entry.listing.license ?? "",
      version: entry.version,
      schema: entry.schema,
      release: entry.releaseUri,
      sha256: entry.sha256,
      preview: entry.preview,
      warnings: entry.warnings.map((warning) => warning.message),
      error: entry.error,
    })),
  };
});
