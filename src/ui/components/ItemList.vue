<script setup lang="ts">
import { computed } from 'vue';
import type { AlternativeGroup, PackingItem } from '../../core/models';
const props = defineProps<{ items: PackingItem[]; groups?: AlternativeGroup[] }>();
const emit = defineEmits<{ remove: [id: string]; toggle: [id: string, mustHave: boolean] }>();
const groupNames = computed(() => {
  const map = new Map<string, string>();
  for (const group of props.groups ?? []) for (const id of group.itemIds) map.set(id, group.name);
  return map;
});
</script>

<template>
  <div class="item-list">
    <article v-for="item in items" :key="item.id" class="item-row">
      <div class="item-icon">{{ item.category.slice(0, 1) }}</div>
      <div class="item-copy"><strong>{{ item.name }}<span v-if="groupNames.get(item.id)" class="group-tag">组 · {{ groupNames.get(item.id) }}</span></strong><span>{{ item.length }}×{{ item.width }}×{{ item.height }} cm · {{ item.weight }} kg</span></div>
      <button class="must-button" :class="{ checked: item.mustHave }" type="button" @click="emit('toggle', item.id, !item.mustHave)">{{ item.mustHave ? '必带' : '可选' }}</button>
      <b class="priority">P{{ item.priority }}</b>
      <button class="icon-button" type="button" :aria-label="`删除 ${item.name}`" @click="emit('remove', item.id)">×</button>
    </article>
  </div>
</template>
