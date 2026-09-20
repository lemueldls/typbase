<script setup lang="ts">
import type { Component } from "vue";

import { Primitive } from "reka-ui";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    /** "plain" is the default bordered button; "ghost" is borderless. */
    variant?: "plain" | "primary" | "danger" | "ghost";
    size?: "default" | "small" | "tiny";
    /** Submit buttons inside forms; everything else stays a plain button. */
    type?: "button" | "submit" | "reset";
    /** Render as a different element, e.g. a label wrapping a file input. */
    as?: string | Component;
  }>(),
  { variant: "plain", size: "default", type: "button", as: "button" },
);
</script>

<template>
  <Primitive
    v-bind="$attrs"
    :as="as"
    :type="as === 'button' ? type : undefined"
    class="button"
    :class="{
      'button--primary': variant === 'primary',
      'button--danger': variant === 'danger',
      'button--ghost': variant === 'ghost',
      'button--small': size === 'small',
      'button--tiny': size === 'tiny',
    }"
  >
    <slot />
  </Primitive>
</template>
