<script setup lang="ts">
import { DATA_LABEL_GROUPS, NOT_COLLECTED_KEYS, type DataLabelVisibility } from "~/lib/dataLabel";
import { openExternal } from "~/lib/openExternal";

withDefaults(
  defineProps<{
    signedIn?: boolean;
    busy?: boolean;
  }>(),
  { signedIn: false, busy: false },
);

const emit = defineEmits<{
  (e: "deleteInstall"): void;
}>();

const visibilityKeys: Record<DataLabelVisibility, string> = {
  device: "dataLabel.visibility.device",
  workspace: "dataLabel.visibility.workspace",
  public: "dataLabel.visibility.public",
  "third-party": "dataLabel.visibility.thirdParty",
};
</script>

<template>
  <div class="account-label">
    <p class="account-label__intro">
      {{ $t("dataLabel.intro") }}
    </p>

    <section v-for="group in DATA_LABEL_GROUPS" :key="group.id" class="account-label__group">
      <h3 class="account-label__heading">{{ $t(group.titleKey) }}</h3>
      <p class="account-label__group-intro">{{ $t(group.introKey) }}</p>

      <ul class="account-label__entries">
        <li v-for="entry in group.entries" :key="entry.id" class="account-label__entry">
          <div class="account-label__entry-head">
            <h4 class="account-label__entry-title">{{ $t(entry.titleKey) }}</h4>
            <span class="account-label__badge" :class="`account-label__badge--${entry.visibility}`">
              {{ $t(visibilityKeys[entry.visibility]) }}
            </span>
          </div>
          <p class="account-label__body">{{ $t(entry.bodyKey) }}</p>

          <details v-if="entry.collections?.length" class="account-label__technical">
            <summary>{{ $t("dataLabel.technicalDetails") }}</summary>
            <ul class="account-label__codes">
              <li v-for="collection in entry.collections" :key="collection">
                <code>{{ collection }}</code>
              </li>
            </ul>
          </details>

          <p class="account-label__removal">
            <strong>{{ $t("dataLabel.removeLabel") }}</strong>
            {{ $t(entry.removalKey) }}
          </p>

          <UiButton
            v-if="entry.action === 'delete-install' && signedIn"
            variant="plain"
            size="small"
            :disabled="busy"
            @click="emit('deleteInstall')"
          >
            {{ $t("dataLabel.deleteInstall") }}
          </UiButton>
        </li>
      </ul>
    </section>

    <section class="account-label__group">
      <h3 class="account-label__heading">{{ $t("dataLabel.notCollectedTitle") }}</h3>
      <ul class="account-label__checks">
        <li v-for="key in NOT_COLLECTED_KEYS" :key="key">
          <MsIcon name="check" :size="16" />
          <span>{{ $t(key) }}</span>
        </li>
      </ul>
    </section>

    <p class="account-label__note">
      {{ $t("dataLabel.note") }}
      {{ $t("dataLabel.browse") }}
      <button type="button" class="account-label__link" @click="openExternal('https://aturi.to')">
        aturi.to</button
      >.
    </p>
  </div>
</template>

<style>
.account-label {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.account-label__intro,
.account-label__group-intro,
.account-label__body,
.account-label__removal,
.account-label__note {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
}

.account-label__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.account-label__heading {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--color-text);
}

.account-label__entries {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.account-label__entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.account-label__entry-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.account-label__entry-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.account-label__badge {
  flex: none;
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--color-text-secondary);
  background: var(--color-surface-3);
  border-radius: var(--radius-full);
}

.account-label__badge--public {
  color: var(--color-warning);
}

.account-label__codes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.account-label__technical {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.account-label__technical summary {
  cursor: pointer;
}

.account-label__codes code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  overflow-wrap: anywhere;
}

.account-label__checks {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.account-label__checks li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.account-label__checks .ms-icon {
  flex: none;
  margin-top: 0.15rem;
  color: var(--color-success);
}

.account-label__note {
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.account-label__link {
  padding: 0;
  font: inherit;
  color: var(--color-accent);
  background: transparent;
  border: 0;
  cursor: pointer;
  text-decoration: underline;
}
</style>
