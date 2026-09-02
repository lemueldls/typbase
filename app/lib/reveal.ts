import { ref } from "vue";

/**
 * Cross-component reveal requests: the search palette asks the open PageView
 * to select a source range. Kept out of props so the palette can live at the
 * app shell and drop a request without touching every page switch path.
 */
export interface RevealRequest {
  pageId: string;
  from: number;
  to: number;
  token: number;
  consumed?: boolean;
}

export const revealRequests = ref<RevealRequest[]>([]);

export function requestReveal(pageId: string, from: number, to: number): void {
  revealRequests.value = [
    ...revealRequests.value,
    { pageId, from, to, token: Date.now() + Math.random() },
  ];
}
