<script setup lang="ts">
import { pushToast } from "~/composables/toasts";
import { requestSave } from "~/lib/saveRequest";

/** Ctrl/Cmd+S saves now and says so. Capture phase: CodeMirror's keymap gets
 *  first look otherwise, and the browser's own save dialog is never wanted. */
function onKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  // `code` keeps the shortcut working on non-Latin layouts.
  if (event.code !== "KeyS" && event.key.toLowerCase() !== "s") return;

  event.preventDefault();
  if (event.repeat) return;

  const saving = requestSave();
  if (!saving) return;

  void saving
    .then((ok) => {
      pushToast(
        ok
          ? { titleKey: "save.saved", duration: 2000 }
          : { titleKey: "save.failed", variant: "danger", duration: 4000 },
      );
    })
    .catch((cause) => {
      console.error("[save] failed:", cause);
      pushToast({ titleKey: "save.failed", variant: "danger", duration: 4000 });
    });
}

// app.vue renders on the server too; `window` only exists on the client.
onMounted(() => {
  useEventListener(window, "keydown", onKeydown, { capture: true });
});
</script>

<template>
  <NuxtRouteAnnouncer />
  <TooltipProvider :delay-duration="500" :skip-delay-duration="300">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <UiToaster />
  </TooltipProvider>
</template>
