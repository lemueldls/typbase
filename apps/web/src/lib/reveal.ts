import { ref } from "vue";

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
