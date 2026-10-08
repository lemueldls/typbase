import type { TypstRequest, TypstState } from "@typbase/engine";

import type { ChatWorkerRequest, ChatWorkerResponse, ChatWorkerStyle } from "~/lib/chatWorker";
import type { FontPayload } from "~/lib/customFonts";

import { themeColorsFromPalette } from "~/lib/rendererPalette";
import { setTypstInputs } from "~/lib/typstInputs";

import { initTypstState, installPayload, payloadKey, requestKey } from "./typstWorkerCore";

let wasmModuleUrl: string | undefined;
let state: TypstState | undefined;
let style: ChatWorkerStyle | undefined;
let styleKey = "";
/** Inputs the state was last configured with. Setting them rebuilds the
 *  library, and the chat streams many renders of the same page. */
let inputsKey = "";

/** Uploaded workspace faces. The worker cannot read the blob store, so the
 *  bytes ride the configure message and install with the bundled fonts. */
let customFonts: FontPayload[] = [];

async function ensureState(): Promise<TypstState> {
  if (state) return state;
  if (!wasmModuleUrl) throw new Error("Chat worker was not configured with a wasm URL");

  state = await initTypstState(wasmModuleUrl);
  for (const font of customFonts) state.installFont(font.bytes);

  return state;
}

/**
 * Fonts, theme, and text size live on a space context, and the message source
 * must share that context or the settings never apply. Keyed by space so a
 * workspace switch re-applies.
 */
function applyStyle(typstState: TypstState, next: ChatWorkerStyle, spaceId: string): void {
  const key = `${spaceId}:${JSON.stringify(next)}`;
  if (key === styleKey) return;

  styleKey = key;
  const config = typstState.createSourceId(`typbase/chat-config/${spaceId}`, spaceId);
  typstState.setFont(config, next.font);
  typstState.setMathFont(config, next.mathFont);
  typstState.setCodeFont(config, next.codeFont);
  typstState.setTextSize(config, next.textSize);
  typstState.setTypography(config, next.ligatures, next.kerning);
  // The code-block theme file referenced by the prelude is generated from the
  // palette. Setting it installs that file into the world.
  typstState.setTheme(config, themeColorsFromPalette(next.palette));
}

let currentId = 0;
let releaseAnswer: ((inserted: number) => void) | undefined;
let insertedKeys = new Set<string>();

self.addEventListener(
  "message",
  async (event: MessageEvent<ChatWorkerRequest | ChatWorkerResponse>) => {
    const message = event.data;

    if (message.type === "configure") {
      wasmModuleUrl = message.wasmUrl;
      if (message.fonts) customFonts = message.fonts;
      if (message.style) style = message.style;

      return;
    }

    if (message.type === "insert" && state) {
      const payload = message.payload;
      if (payload) installPayload(state, payload);
      if (payload) insertedKeys.add(payloadKey(payload));

      return;
    }

    if (message.type === "answer") {
      const release = releaseAnswer;
      releaseAnswer = undefined;
      release?.(message.inserted ?? 0);

      return;
    }

    if (message.type !== "compile") return;

    currentId = message.id;
    insertedKeys = new Set();
    const { mode, source, prelude, spaceId } = message;
    if (message.style) style = message.style;

    try {
      const typstState = await ensureState();
      if (style) applyStyle(typstState, style, spaceId);
      // Setting inputs rebuilds the library. The chat streams many renders of
      // the same page, so only do it when the values change.
      const inputs = `chat:${spaceId}`;
      if (inputs !== inputsKey) {
        inputsKey = inputs;
        setTypstInputs(typstState, { workspaceId: spaceId, reason: "chat" });
      }

      // One source file per workspace: file ids intern by path, so a shared
      // path would apply this workspace's style to another workspace's context.
      const file = typstState.createSourceId(`typbase/chat/${spaceId}`, spaceId);
      typstState.insertSource(file, source);

      if (mode === "check") {
        await runPasses(
          () => typstState.checkHTML(file, source, prelude),
          (checked) =>
            post({
              id: currentId,
              type: "result",
              ok: true,
              diagnostics: checked.diagnostics,
            }),
        );

        return;
      }

      await runPasses(
        () => typstState.renderHtml(file, source, prelude),
        (rendered) =>
          post({
            id: currentId,
            type: "result",
            ok: true,
            html: rendered.document ?? undefined,
            diagnostics: rendered.diagnostics,
          }),
      );
    } catch (error) {
      post({
        id: currentId,
        type: "result",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

interface RequestPass {
  requests: TypstRequest[];
}

/** Compiles until requests stop coming. A pass that inserts nothing stops
 *  with a readable error instead of looping. */
async function runPasses<T extends RequestPass>(
  run: () => T,
  settle: (result: T) => void,
): Promise<void> {
  for (let pass = 0; pass < 8; pass++) {
    const result = run();
    if (!result.requests.length) {
      settle(result);

      return;
    }

    const inserted = await requestLoop(result.requests);
    if (inserted === 0) {
      post({
        id: currentId,
        type: "result",
        ok: false,
        error: `Chat compile needs files that could not be resolved: ${result.requests
          .map(requestKey)
          .join(", ")}`,
      });

      return;
    }
  }

  post({
    id: currentId,
    type: "result",
    ok: false,
    error: "Chat compile did not converge after 8 request passes.",
  });
}

async function requestLoop(requests: TypstRequest[]): Promise<number> {
  const fresh = requests.filter((request) => !insertedKeys.has(requestKey(request)));
  if (!fresh.length) return 0;

  postMessage({ id: currentId, type: "request", requests: fresh } satisfies ChatWorkerResponse);

  return new Promise<number>((resolve) => {
    releaseAnswer = resolve;
  });
}

function post(response: ChatWorkerResponse): void {
  (self as unknown as Worker).postMessage(response);
}
