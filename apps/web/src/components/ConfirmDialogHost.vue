<script setup lang="ts">
const { pending, open, settle } = useConfirm();
</script>

<template>
  <UiConfirmDialog
    :open="open"
    :title="pending?.title ?? ''"
    :description="pending?.description"
    :confirm-label="pending?.confirmLabel"
    :cancel-label="pending?.cancelLabel"
    :danger="pending?.danger"
    @update:open="(value) => !value && settle(false)"
    @confirm="settle(true)"
  />
</template>
