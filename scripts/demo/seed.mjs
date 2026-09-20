/**
 * Demo workspace contents. The capture script builds this workspace inside the
 * app through its own storage package, so screenshots always start from the
 * same state. See docs/demo.md for the shot list.
 *
 * Plugins are work in progress and deliberately not part of the demo yet.
 */

const HOME = `= Reading log

A home page that reads the workspace. The lists below come from \`#typbase.query\`.

== Reading

#let reading = typbase.query("pages", filter: "by-category/reading")

#for page in reading [
  - #typbase.page-link(page.id)
]

== Recent days

#let daily = typbase.query("daily")

#for note in daily.rev().slice(0, 4) [
  - #typbase.page-link(note.id)
]
`;

const ATTENTION = `// %% [markup]
= Attention, from scratch

Scaled dot-product attention:

$ "Attention"(Q, K, V) = op("softmax")((Q K^top) / sqrt(d_k)) V $

// %% [code]
#let rows = ((1, 1), (2, 3), (3, 6), (4, 10), (5, 15))

#for (k, total) in rows [
  #box(width: total * 0.35cm, height: 0.45cm, fill: theme.accent, radius: 2pt)
  #h(0.3em) #k: #total
  #linebreak()
]

// %% [markup]
== Why divide by $sqrt(d_k)$?

The dot products grow with the dimension, so the softmax saturates.
Scaling keeps the gradients usable.
`;

// The example from Typst's own README, kept verbatim so the demo shows a
// document people already recognize.
const FIBONACCI = `#set heading(numbering: "1.")

= Fibonacci sequence

The Fibonacci sequence is defined through the
recurrence relation $F_n = F_(n-1) + F_(n-2)$.
It can also be expressed in _closed form:_

$ F_n = round(1 / sqrt(5) phi.alt^n), quad
  phi.alt = (1 + sqrt(5)) / 2 $

#let count = 8
#let nums = range(1, count + 1)
#let fib(n) = (
  if n <= 2 { 1 }
  else { fib(n - 1) + fib(n - 2) }
)

The first #count numbers of the sequence are:

#align(center, table(
  columns: count,
  ..nums.map(n => $F_#n$),
  ..nums.map(n => str(fib(n))),
))
`;

const LENS = `= Thin lens

The thin lens equation relates the focal length $f$ to the object distance
$d_o$ and the image distance $d_i$:
`;

/** YYYY-MM-DD for `offset` days before today, in UTC like the store. */
function isoDay(offset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);

  return date.toISOString().slice(0, 10);
}

const DAILY_LINES = [
  "Read the attention paper and wrote up the notebook.",
  "Added the reading list and linked the notes.",
  "Cleaned up the daily note template.",
  "",
];

/** `[date, prose]` pairs for the last few days. */
export function dailyNotes() {
  return DAILY_LINES.map((line, index) => [isoDay(index - (DAILY_LINES.length - 1)), line]);
}

/**
 * Seeds the demo workspace and returns the page ids the capture script needs.
 * Runs against the app's own `@typbase/storage` module, so the workspace is
 * exactly what the app would have written itself.
 */
export async function seedWorkspace(page, { workspaceId }) {
  const dailyPlan = dailyNotes();

  return page.evaluate(
    async ({ workspaceId: id, home, attention, fibonacci, lens, daily }) => {
      const { WorkspaceStore, OPFSBackend } = await import("/@id/@typbase/storage");

      const backend = await OPFSBackend.open();
      const store = await WorkspaceStore.open(backend, id, { name: "Demo" });

      // Idempotent: clear anything a previous run left in this profile.
      for (const install of store.listPluginInstalls()) await store.uninstallPlugin(install.id);
      for (const existing of store.listPages()) await store.deletePage(existing.id);

      const category = await store.addCategory("reading");

      const attentionPage = await store.createPage({
        title: "Attention",
        kind: "notebook",
        categoryId: category.id,
        content: attention,
      });

      const readingList = [
        "= Reading list",
        "",
        "Papers to work through, one notebook each.",
        "",
        `- #typbase.page-link("${attentionPage.id}")`,
        "",
      ].join("\n");

      const homePage = await store.createPage({ title: "Home", content: home });
      const fibonacciPage = await store.createPage({ title: "Fibonacci", content: fibonacci });
      const lensPage = await store.createPage({ title: "Thin lens", content: lens });
      await store.createPage({
        title: "Reading list",
        categoryId: category.id,
        content: readingList,
      });

      for (const [date, prose] of daily) {
        const note = await store.createDailyNote(date);
        const template = await store.loadPageText(note.id);
        await store.setPageText(note.id, `${template.trimEnd()}\n\n${prose}\n`);
      }

      store.updateSettings({
        name: "Demo",
        homePageId: homePage.id,
        theme: "light",
        themeName: "default",
        uiSize: "default",
        uiDensity: "default",
        uiRadius: "default",
        spellcheck: "off",
        notebook: { autoRun: true, showCounters: true },
      });

      await store.flush();
      await backend.write(
        "workspaces.json",
        new TextEncoder().encode(
          JSON.stringify([{ id, name: "Demo", createdAt: Date.now(), lastOpenedAt: Date.now() }]),
        ),
      );

      return {
        home: homePage.id,
        attention: attentionPage.id,
        fibonacci: fibonacciPage.id,
        lens: lensPage.id,
      };
    },
    {
      workspaceId,
      home: HOME,
      attention: ATTENTION,
      fibonacci: FIBONACCI,
      lens: LENS,
      daily: dailyPlan,
    },
  );
}
