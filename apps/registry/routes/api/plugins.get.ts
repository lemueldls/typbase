import { defineHandler } from "nitro";

import { registryCatalog } from "../../lib/catalog";

export default defineHandler(async () => {
  const catalog = await registryCatalog();

  return {
    publishers: catalog.publishers,
    warnings: catalog.warnings,
    plugins: catalog.entries.map((entry) => ({
      uri: entry.uri,
      publisher: entry.publisher,
      name: entry.listing.name,
      description: entry.listing.description ?? "",
      icon: entry.listing.icon ?? "",
      tags: entry.listing.tags ?? [],
      version: entry.version,
      api: entry.api,
      capabilities: entry.capabilities,
      release: entry.releaseUri,
      sha256: entry.sha256,
    })),
  };
});
