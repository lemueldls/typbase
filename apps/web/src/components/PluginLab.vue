<script setup lang="ts">
/**
 * Debug lab for the plugin runtime: engine health, catalog and error counts,
 * and the runtime log. Authoring lives on /plugins (the studio); this page
 * stays for diagnosing the compiler and the worker fallback.
 */
const plugins = usePlugins();
const router = useRouter();

function develop(pluginId: string) {
  void router.push({ path: "/plugins", query: { plugin: pluginId } });
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString();
}
</script>

<template>
  <div class="lab-plugin">
    <section class="lab-plugin__group">
      <h3 class="lab-plugin__title">Engine</h3>
      <p class="lab-plugin__row">
        <span>
          Mode: <strong>{{ plugins.engine.mode }}</strong> · worker crashes:
          {{ plugins.engine.workerCrashes }}
        </span>
        <UiButton size="small" @click="plugins.resetEngine()"> Retry worker </UiButton>
      </p>
      <pre v-if="plugins.engine.lastError" class="lab-plugin__error">{{
        plugins.engine.lastError
      }}</pre>
    </section>

    <section class="lab-plugin__group">
      <h3 class="lab-plugin__title">Catalog</h3>
      <ul class="lab-plugin__plugins">
        <li
          v-for="entry in plugins.catalog.value"
          :key="entry.manifest.id"
          class="lab-plugin__plugin"
        >
          <span class="lab-plugin__plugin-name">{{ entry.manifest.name }}</span>
          <span class="lab-plugin__muted">{{ entry.source }}</span>
          <span class="lab-plugin__muted">
            {{ entry.manifest.surfaces.map((surface) => surface.kind).join(", ") }}
          </span>
          <span v-if="plugins.errorsFor(entry.manifest.id).length" class="lab-plugin__count">
            {{ plugins.errorsFor(entry.manifest.id).length }} issue(s)
          </span>
          <UiButton size="small" variant="ghost" @click="develop(entry.manifest.id)">
            Studio
          </UiButton>
        </li>
      </ul>
      <p v-if="plugins.errors.value.length" class="lab-plugin__muted">
        {{ plugins.errors.value.length }} runtime error(s) across plugins.
      </p>
    </section>

    <section class="lab-plugin__group">
      <div class="lab-plugin__row">
        <h3 class="lab-plugin__title">Logs ({{ plugins.logs.value.length }})</h3>
        <UiButton size="small" @click="plugins.clearLogs()"> Clear </UiButton>
      </div>
      <ul class="lab-plugin__logs">
        <li v-for="(entry, index) in plugins.logs.value" :key="index" class="lab-plugin__log">
          <span class="lab-plugin__log-kind lab-plugin__log-kind--{{ entry.kind }}">
            {{ entry.kind }}
          </span>
          <span class="lab-plugin__log-time">{{ formatTime(entry.at) }}</span>
          <span class="lab-plugin__log-message">{{ entry.message }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style>
.lab-plugin {
  display: grid;
  gap: var(--space-4);
}

.lab-plugin__group {
  display: grid;
  gap: var(--space-2);
}

.lab-plugin__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.lab-plugin__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1-5);
}

.lab-plugin__plugins {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-1);
}

.lab-plugin__plugin {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.lab-plugin__plugin-name {
  font-weight: 600;
}

.lab-plugin__count {
  color: var(--color-danger);
}

.lab-plugin__error {
  margin: 0;
  padding: var(--space-2-5);
  font-size: var(--text-xs);
  color: var(--color-danger);
  white-space: pre-wrap;
  background: var(--color-danger-soft);
  border-radius: var(--radius-sm);
}

.lab-plugin__logs {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-1);
  max-height: 16rem;
  overflow-y: auto;
}

.lab-plugin__log {
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.lab-plugin__log-kind {
  flex: none;
  width: 3.6rem;
  text-transform: uppercase;
  font-size: var(--text-2xs);
  font-weight: 700;
  color: var(--color-text-secondary);
}

.lab-plugin__log-kind--error {
  color: var(--color-danger);
}

.lab-plugin__log-kind--patch {
  color: var(--color-ok);
}

.lab-plugin__log-time {
  flex: none;
  color: var(--color-text-secondary);
}

.lab-plugin__log-message {
  min-width: 0;
  overflow-wrap: anywhere;
}

.lab-plugin__muted {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
</style>
