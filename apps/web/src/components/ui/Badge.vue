<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Semantic color pair. */
    tone?: "neutral" | "accent" | "ok" | "warning" | "danger" | "info";
    /** Soft fills a tinted surface, solid fills the tone, outline is transparent. */
    variant?: "soft" | "solid" | "outline";
    /** Small uses the 2xs text step, default uses xs. */
    size?: "small" | "default";
    /** Pill is the default, rounded uses the small corner radius. */
    shape?: "pill" | "rounded";
  }>(),
  { tone: "neutral", variant: "soft", size: "small", shape: "pill" },
);
</script>

<template>
  <span
    class="ui-badge"
    :class="[
      `ui-badge--${tone}`,
      `ui-badge--${variant}`,
      `ui-badge--${size}`,
      { 'ui-badge--rounded': shape === 'rounded' },
    ]"
  >
    <slot />
  </span>
</template>

<style>
.ui-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  flex: none;
  padding: 0 var(--space-1-5);
  font-size: var(--text-2xs);
  font-weight: 500;
  line-height: var(--leading-normal);
  white-space: nowrap;
  border-radius: var(--radius-full);
}

.ui-badge--default {
  padding: var(--space-0-5) var(--space-1-5);
  font-size: var(--text-xs);
}

.ui-badge--rounded {
  border-radius: var(--radius-xs);
}

.ui-badge--soft {
  color: var(--color-text-secondary);
  background: var(--color-surface-3);
}

.ui-badge--soft.ui-badge--accent {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.ui-badge--soft.ui-badge--ok {
  color: var(--color-ok);
  background: var(--color-ok-soft);
}

.ui-badge--soft.ui-badge--warning {
  color: var(--color-warning);
  background: var(--color-warning-soft);
}

.ui-badge--soft.ui-badge--danger {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.ui-badge--soft.ui-badge--info {
  color: var(--color-info);
  background: var(--color-info-soft);
}

.ui-badge--solid {
  color: var(--color-surface);
  background: var(--color-text-secondary);
}

.ui-badge--solid.ui-badge--accent {
  color: var(--color-on-accent);
  background: var(--color-accent);
}

.ui-badge--solid.ui-badge--ok {
  background: var(--color-ok);
}

.ui-badge--solid.ui-badge--warning {
  background: var(--color-warning);
}

.ui-badge--solid.ui-badge--danger {
  color: var(--color-on-danger);
  background: var(--color-danger);
}

.ui-badge--solid.ui-badge--info {
  background: var(--color-info);
}

.ui-badge--outline {
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
}

.ui-badge--outline.ui-badge--accent {
  color: var(--color-accent);
  border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
}

.ui-badge--outline.ui-badge--ok {
  color: var(--color-ok);
  border-color: color-mix(in srgb, var(--color-ok) 40%, var(--color-border));
}

.ui-badge--outline.ui-badge--warning {
  color: var(--color-warning);
  border-color: color-mix(in srgb, var(--color-warning) 40%, var(--color-border));
}

.ui-badge--outline.ui-badge--danger {
  color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 40%, var(--color-border));
}

.ui-badge--outline.ui-badge--info {
  color: var(--color-info);
  border-color: color-mix(in srgb, var(--color-info) 40%, var(--color-border));
}
</style>
