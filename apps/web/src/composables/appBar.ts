import type { LocalState } from "@typbase/storage";

/**
 * The app bar's visibility.
 *
 * It lives in the workspace's device-local state (`local.json`), next to the
 * plugin windows' geometry: how much chrome a window shows is not something to
 * sync to another device, and it must stay out of the workspace doc. The
 * Settings appearance tab and the `Mod-J` chord both write here.
 *
 * Off until asked for. The bar is a strip on top of the pane toolbars, and a
 * workspace that is used all day does not need two rows of window chrome for
 * navigation it does not use.
 */

const KEY = "appBarVisible";

const visible = ref(false);
/** The local state the current value came from, so a switch reloads it. */
let loadedFrom: LocalState | undefined;

export function useAppBar() {
  const { localState } = useWorkspace();

  async function load(local: LocalState | undefined): Promise<void> {
    // A workspace switch brings a different file, so the value reloads with it.
    if (!local || loadedFrom === local) return;
    loadedFrom = local;

    try {
      visible.value = (await local.get<boolean>(KEY)) ?? false;
    } catch {
      visible.value = false;
    }
  }

  watch(localState, (local) => void load(local), { immediate: true });

  function persist(): void {
    const local = localState.value;
    if (!local) return;

    void local.set(KEY, visible.value).then(() => local.flush());
  }

  return {
    /** Writable so a switch can bind to it; writing saves the choice. */
    visible: computed({
      get: () => visible.value,
      set: (value) => {
        visible.value = value;
        persist();
      },
    }),
    toggle(): void {
      visible.value = !visible.value;
      persist();
    },
  };
}
