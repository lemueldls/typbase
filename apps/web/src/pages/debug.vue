<script setup lang="ts">
import type { TypstState } from "@typbase/engine";

import {
  type CapturedLog,
  RECOVERY_CASES,
  captureConsole,
  compileForLab,
  runIndexCheck,
  typingSimulation,
  validateReport,
  type CaseResult,
  type CheckedSegment,
  type CompileReport,
} from "~/lib/typstLab";

const REPRO_SOURCE = [
  "= Welcome to typbase",
  "",
  "This is a *Typst* document, and the app reads it as data:",
  "",
  '- `#typbase.query("pages")` reads app data as JSON',
  '- `#typbase.embed("<page-id>")` includes another page',
  "",
  "Every page in this workspace:",
  "",
  '#let pages = typbase.query("pages")',
  "",
  "#for page in pages [",
  "  - #page.title (#page.path)",
  "]",
  "",
  "== Your turn",
  "",
  "Create a page from the sidebar, or open today's daily note.",
].join("\n");

const source = ref(REPRO_SOURCE);
const report = ref<CompileReport>();
const running = ref(false);
const captured = ref<CapturedLog[]>([]);
const error = ref<string>();

const { ensure, workspace, workspaceId, dataRevision, wipeStorage } = useWorkspace();
const typstState = shallowRef<TypstState>();

const store = computed(() => workspace.value);

const pagesCount = computed(() => {
  void dataRevision.value;

  return store.value?.listPages().length ?? 0;
});

/* wasm memory meter refreshes on activity; bump with the lab runs */
const wasmMemoryMB = ref(0);
onMounted(() => {
  const tick = () => {
    if (typstState.value) wasmMemoryMB.value = Math.round(typstState.value.memoryBytes() / 1e6);
  };
  setInterval(tick, 2000);
});

const indexCheck = ref<{
  ok: boolean;
  checked: number;
  mismatches: string[];
  segments: CheckedSegment[];
}>();
const indexCheckRunning = ref(false);

async function runIndexMappingCheck() {
  indexCheckRunning.value = true;
  try {
    await ensure();
    typstState.value ??= await useTypst();
    indexCheck.value = await runIndexCheck(typstState.value, workspaceId.value, source.value);
  } catch (reason) {
    indexCheck.value = {
      ok: false,
      checked: 0,
      mismatches: [reason instanceof Error ? reason.message : String(reason)],
      segments: [],
    };
  } finally {
    indexCheckRunning.value = false;
  }
}

const typingReport = ref<{
  prefixes: number;
  crashes: string | null;
  wasmStartMB: number;
  wasmEndMB: number;
}>();
const typingRunning = ref(false);

async function runTypingSimulation() {
  typingRunning.value = true;
  try {
    const storeInstance = await ensure();
    if (!storeInstance) throw new Error("No workspace is open.");
    typstState.value ??= await useTypst();
    typingReport.value = await typingSimulation(
      typstState.value,
      storeInstance,
      workspaceId.value,
      source.value,
    );
  } catch (reason) {
    typingReport.value = {
      prefixes: 0,
      crashes: reason instanceof Error ? reason.message : String(reason),
      wasmStartMB: 0,
      wasmEndMB: 0,
    };
  } finally {
    typingRunning.value = false;
  }
}

const battery = ref<CaseResult[]>([]);
const batteryRunning = ref(false);

async function runRecoveryBattery() {
  batteryRunning.value = true;
  battery.value = [];

  const consoleCapture = captureConsole();
  try {
    const storeInstance = await ensure();
    if (!storeInstance) throw new Error("No workspace is open.");
    typstState.value ??= await useTypst();

    for (const testCase of RECOVERY_CASES) {
      let result: CaseResult;
      try {
        const compiled = await compileForLab(
          typstState.value,
          storeInstance,
          workspaceId.value,
          testCase.source,
        );
        result = {
          id: testCase.id,
          label: testCase.label,
          crash: null,
          frames: compiled.frames.length,
          diagnostics: compiled.diagnostics.length,
          issues: validateReport(compiled, testCase.source),
        };
      } catch (reason) {
        result = {
          id: testCase.id,
          label: testCase.label,
          crash: reason instanceof Error ? reason.message : String(reason),
          frames: 0,
          diagnostics: 0,
          issues: [],
        };
      }
      battery.value = [...battery.value, result];
    }
    captured.value = consoleCapture.captured.slice(-160);
  } finally {
    consoleCapture.restore();
    batteryRunning.value = false;
  }
}

async function run() {
  if (!source.value.trim()) return;

  running.value = true;
  error.value = undefined;
  report.value = undefined;

  const consoleCapture = captureConsole();
  try {
    const storeInstance = await ensure();
    if (!storeInstance) throw new Error("No workspace is open.");
    typstState.value ??= await useTypst();
    report.value = await compileForLab(
      typstState.value,
      storeInstance,
      workspaceId.value,
      source.value,
    );
    captured.value = consoleCapture.captured.slice(-120);
  } catch (reason) {
    error.value =
      reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason);
  } finally {
    consoleCapture.restore();
    running.value = false;
  }
}

async function resetWorkspace() {
  if (
    !window.confirm(
      "Delete every workspace from the active storage and reload? This cannot be undone.",
    )
  ) {
    return;
  }

  try {
    await ensure();
    await wipeStorage();
  } catch {
    // Nothing left to wipe; the reload still resets the in-memory state.
  }
  window.location.reload();
}

definePageMeta({ ssr: false });
</script>

<template>
  <main class="lab">
    <header class="lab__header">
      <h1>Typst lab</h1>
      <p class="lab__hint">
        Compile arbitrary Typst against the live workspace. Diagnostics, requests, and wasm logs
        surface here. Dev tooling, not product UI.
      </p>
    </header>

    <section class="lab__workspace">
      <h2>Workspace</h2>
      <dl class="lab__facts">
        <div>
          <dt>Pages</dt>
          <dd>{{ pagesCount }}</dd>
        </div>
        <div>
          <dt>Categories</dt>
          <dd>{{ store?.listCategories().length ?? 0 }}</dd>
        </div>
        <div>
          <dt>Settings</dt>
          <dd>{{ JSON.stringify(store?.getSettings().name) }}</dd>
        </div>
        <div>
          <dt>System fonts</dt>
          <dd>{{ systemFontFamilies.length }}</dd>
        </div>
        <div>
          <dt>Wasm memory</dt>
          <dd>{{ wasmMemoryMB }} MB</dd>
        </div>
      </dl>
      <UiButton class="button--color-danger" @click="resetWorkspace">
        Wipe storage and reload
      </UiButton>
    </section>

    <StorageExplorer />

    <section class="lab__plugins">
      <h2>Plugins</h2>
      <PluginManager />
      <PluginLab />
    </section>

    <section class="lab__run">
      <Label class="lab__field">
        <span>Typst source</span>
        <textarea v-model="source" rows="14" class="lab__input" spellcheck="false" />
      </Label>
      <div class="lab__actions">
        <UiButton variant="primary" :disabled="running" @click="run">
          {{ running ? "Compiling..." : "Compile" }}
        </UiButton>
        <UiButton :disabled="indexCheckRunning" @click="runIndexMappingCheck">
          {{ indexCheckRunning ? "Checking..." : "Check index" }}
        </UiButton>
        <UiButton :disabled="typingRunning" @click="runTypingSimulation">
          {{ typingRunning ? "Typing..." : "Simulate typing" }}
        </UiButton>
      </div>
    </section>

    <section
      v-if="typingReport"
      class="lab__check"
      :class="{ 'lab__check--fail': typingReport.crashes }"
    >
      <h2>Typing simulation</h2>
      <p>
        {{ typingReport.prefixes }} prefixes compiled
        {{ typingReport.crashes ? `— crashed: ${typingReport.crashes}` : "— no crash" }}
        · wasm heap {{ typingReport.wasmStartMB }} → {{ typingReport.wasmEndMB }} MB
      </p>
    </section>

    <section v-if="indexCheck" class="lab__check" :class="{ 'lab__check--fail': !indexCheck.ok }">
      <h2>Index mapping check</h2>
      <p>
        {{ indexCheck.ok ? "OK" : "FAILED" }} — {{ indexCheck.checked }} positions per direction
      </p>
      <ul v-if="indexCheck.mismatches.length">
        <li v-for="mismatch in indexCheck.mismatches.slice(0, 20)" :key="mismatch">
          <code>{{ mismatch }}</code>
        </li>
      </ul>
      <details v-if="indexCheck.segments.length" class="lab__segments">
        <summary>{{ indexCheck.segments.length }} segments</summary>
        <table class="lab__table">
          <thead>
            <tr>
              <th>#</th>
              <th>kind</th>
              <th>from</th>
              <th>to</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(segment, index) in indexCheck.segments" :key="index">
              <td>{{ index }}</td>
              <td>
                <code>{{ segment.generated ? `${segment.kind} (generated)` : segment.kind }}</code>
              </td>
              <td>
                <code>{{ segment.from }}..{{ segment.from_end }}</code>
              </td>
              <td>
                <code>{{ segment.to }}..{{ segment.to_end }}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>

    <section class="lab__battery">
      <div class="lab__actions">
        <h2>Recovery battery</h2>
        <UiButton :disabled="batteryRunning" @click="runRecoveryBattery">
          {{ batteryRunning ? "Running..." : `Run ${RECOVERY_CASES.length} cases` }}
        </UiButton>
      </div>
      <table v-if="battery.length" class="lab__table">
        <thead>
          <tr>
            <th>Case</th>
            <th>Frames</th>
            <th>Diags</th>
            <th>Issues</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="result in battery"
            :key="result.id"
            :class="{
              'lab__table-row--fail': result.crash || result.issues.length,
            }"
          >
            <td>{{ result.label }}</td>
            <td>{{ result.crash ? "crash" : result.frames }}</td>
            <td>{{ result.diagnostics }}</td>
            <td>
              <span v-if="result.crash" class="lab__crash">{{ result.crash }}</span>
              <span v-else-if="result.issues.length">{{ result.issues.join("; ") }}</span>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-if="error" class="lab__error">{{ error }}</p>

    <template v-if="report">
      <section class="lab__report">
        <h2>Result</h2>
        <p>
          {{ report.frames.length }} frames · {{ report.diagnostics.length }} diagnostics ·
          {{ report.durationMs.toFixed(0) }}ms · {{ report.resolvedRequests.length }} requests
          resolved
          <span v-if="report.requests.length">({{ report.requests.length }} unresolved)</span>
        </p>

        <h3>Diagnostics</h3>
        <ul class="lab__diags">
          <li v-for="(diagnostic, index) in report.diagnostics" :key="index">
            <span class="lab__sev" :class="`lab__sev--${diagnostic.severity.toLowerCase()}`">
              {{ diagnostic.severity }}
            </span>
            {{ diagnostic.range.start }}..{{ diagnostic.range.end }} —
            {{ diagnostic.message }}
            <ul v-if="diagnostic.hints.length">
              <li v-for="hint in diagnostic.hints" :key="hint" class="lab__hint">
                {{ hint }}
              </li>
            </ul>
          </li>
          <li v-if="report.diagnostics.length === 0">none</li>
        </ul>

        <h3>Resolved requests</h3>
        <ul class="lab__requests">
          <li v-for="request in report.resolvedRequests" :key="JSON.stringify(request)">
            {{ request.type }}: {{ JSON.stringify(request.value ?? request) }}
          </li>
          <li v-if="report.resolvedRequests.length === 0">none</li>
        </ul>
      </section>
    </template>

    <section v-if="captured.length" class="lab__console">
      <h2>Wasm console (last {{ captured.length }})</h2>
      <pre class="lab__pre">{{
        captured.map((entry) => `[${entry.level}] ${entry.line}`).join("\n") || "nothing captured"
      }}</pre>
    </section>
  </main>
</template>

<style scoped>
.lab {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 100vh;
}

.lab__header h1 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-3xl);
}

.lab__hint {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-md);
}

.lab__workspace,
.lab__run,
.lab__report,
.lab__console {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  background: var(--color-surface);
}

.lab__facts {
  display: flex;
  gap: var(--space-6);
  margin: 0 0 var(--space-3);
}

.lab__facts dt {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.lab__facts dd {
  margin: 0;
  font-weight: 600;
}

.button--color-danger {
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.lab__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  margin-bottom: var(--space-3);
}

.lab__field span {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.lab__input {
  font-family: var(--font-mono);
  font-size: var(--text-md);
  padding: var(--space-2-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  resize: vertical;
}

.lab__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2-5);
}

.lab__actions h2 {
  margin-right: auto;
}

.lab__check {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  background: var(--color-surface);
}

.lab__check--fail {
  border-color: var(--color-danger);
}

.lab__check ul {
  font-size: var(--text-sm);
  color: var(--color-danger);
}

.lab__battery {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  background: var(--color-surface);
}

.lab__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-md);
  margin-top: var(--space-3);
}

.lab__table th,
.lab__table td {
  text-align: left;
  padding: var(--space-1-5) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.lab__table-row--fail td {
  color: var(--color-danger);
}

.lab__crash {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.lab__error {
  color: var(--color-danger);
  white-space: pre-wrap;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.lab__diags,
.lab__requests {
  padding-left: var(--space-5);
  font-size: var(--text-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.lab__sev {
  font-weight: 700;
  text-transform: uppercase;
}

.lab__sev--error {
  color: var(--color-danger);
}

.lab__hint {
  color: var(--color-text-secondary);
}

.lab__pre {
  max-height: 22rem;
  overflow: auto;
  background: #111;
  color: #ddd;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  white-space: pre-wrap;
}

.lab__plugins {
  display: grid;
  gap: var(--space-3);
}
</style>
