<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { validateGroupDraft } from '../../core/alternative-engine';
import type { AlternativeGroup, PackingItem, PlanMode, TrialCandidate, TrialResult } from '../../core/models';

const props = defineProps<{
  items: PackingItem[];
  groups: AlternativeGroup[];
  trial: TrialResult | null;
  trialStale: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{
  saveGroup: [draft: AlternativeGroup];
  removeGroup: [id: string];
  runTrial: [];
  confirmTrial: [];
}>();

const PLAN_NAMES: Record<PlanMode, string> = { minimal: '精简版', comfort: '舒适版', shopping: '购物版' };
const draft = reactive({ name: '', required: false, itemIds: [] as string[] });
const errors = ref<string[]>([]);

const groupedIds = computed(() => new Set(props.groups.flatMap((group) => group.itemIds)));
const availableItems = computed(() => props.items.filter((item) => !groupedIds.value.has(item.id)));
const draftHasMustHave = computed(() => draft.itemIds.some((id) => props.items.find((item) => item.id === id)?.mustHave));
const otherCandidates = computed(() => (props.trial ? props.trial.candidates.slice(1, 6) : []));
const hiddenCount = computed(() => (props.trial ? Math.max(0, props.trial.candidates.length - 1 - otherCandidates.value.length) : 0));

function itemName(id: string | null) {
  if (id === null) return '不携带';
  return props.items.find((item) => item.id === id)?.name ?? '未知物品';
}
function groupName(id: string) {
  return props.groups.find((group) => group.id === id)?.name ?? '';
}
function selectionLabel(candidate: TrialCandidate) {
  return candidate.selection.map((entry) => `${groupName(entry.groupId)}→${itemName(entry.itemId)}`).join(' · ');
}

function toggleDraftItem(id: string, checked: boolean) {
  draft.itemIds = checked ? [...draft.itemIds, id] : draft.itemIds.filter((itemId) => itemId !== id);
}
function submitDraft() {
  const payload: AlternativeGroup = {
    id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: draft.name,
    required: draft.required || draftHasMustHave.value,
    itemIds: [...draft.itemIds],
  };
  errors.value = validateGroupDraft(payload, props.items, props.groups);
  if (errors.value.length) return;
  emit('saveGroup', payload);
  draft.name = '';
  draft.required = false;
  draft.itemIds = [];
}
function toggleRequired(group: AlternativeGroup) {
  const payload = { ...group, required: !group.required };
  errors.value = validateGroupDraft(payload, props.items, props.groups);
  if (errors.value.length) return;
  emit('saveGroup', payload);
}
function move(group: AlternativeGroup, index: number, delta: number) {
  const itemIds = [...group.itemIds];
  const target = index + delta;
  if (target < 0 || target >= itemIds.length) return;
  [itemIds[index], itemIds[target]] = [itemIds[target], itemIds[index]];
  emit('saveGroup', { ...group, itemIds });
}
</script>

<template>
  <section class="panel alt-panel">
    <div class="section-title"><div><span>03 / ALTERNATIVES</span><h2>替代组合试算</h2></div><b>{{ groups.length }} 组</b></div>

    <article v-for="group in groups" :key="group.id" class="alt-group">
      <div class="alt-group-head">
        <strong>{{ group.name }}</strong>
        <span class="alt-badge" :class="group.required ? 'required' : 'optional'">{{ group.required ? '必带组' : '可选组' }}</span>
        <button type="button" class="mini" @click="toggleRequired(group)">{{ group.required ? '转为可选' : '转为必带' }}</button>
        <button type="button" class="mini danger" :aria-label="`解散 ${group.name}`" @click="emit('removeGroup', group.id)">解散</button>
      </div>
      <ol class="alt-members">
        <li v-for="(id, index) in group.itemIds" :key="id">
          <span class="rank">{{ index + 1 }}</span>
          <span class="alt-chip">{{ itemName(id) }}</span>
          <button type="button" class="mini" :aria-label="`上移 ${itemName(id)}`" :disabled="index === 0" @click="move(group, index, -1)">↑</button>
          <button type="button" class="mini" :aria-label="`下移 ${itemName(id)}`" :disabled="index === group.itemIds.length - 1" @click="move(group, index, 1)">↓</button>
        </li>
      </ol>
      <p class="alt-hint">顺序即组内偏好，试装时每组最多装入一件。</p>
    </article>

    <form class="alt-form" data-testid="alt-group-form" @submit.prevent="submitDraft">
      <input v-model="draft.name" aria-label="分组名称" placeholder="新分组名称，如：外套二选一" />
      <div class="alt-check-list">
        <label v-for="item in availableItems" :key="item.id">
          <input type="checkbox" :checked="draft.itemIds.includes(item.id)" @change="toggleDraftItem(item.id, ($event.target as HTMLInputElement).checked)" />
          {{ item.name }}<em v-if="item.mustHave">必带</em>
        </label>
        <p v-if="!availableItems.length" class="alt-hint">所有物品都已在分组中。</p>
      </div>
      <label class="alt-required"><input v-model="draft.required" type="checkbox" :disabled="draftHasMustHave" /> 整组必带<em v-if="draftHasMustHave">（含必带物品，须为必带组）</em></label>
      <button type="submit" class="alt-create">＋ 创建分组</button>
    </form>
    <p v-for="error in errors" :key="error" class="field-error">{{ error }}</p>

    <div class="alt-actions">
      <button type="button" class="trial-run" data-testid="run-trial" :disabled="disabled || !groups.length" @click="emit('runTrial')">开始试算</button>
      <button type="button" class="trial-confirm" data-testid="confirm-trial" :disabled="!trial || trialStale || !trial.recommended" @click="emit('confirmTrial')">确认采用推荐组合</button>
    </div>

    <div v-if="trial" class="trial-result" data-testid="trial-result">
      <p v-if="trialStale" class="stale-banner">清单或行李箱已变化，本次推荐已失效，请重新试算。</p>
      <p class="trial-status" :class="{ limited: !trial.exhaustive }">
        {{ trial.exhaustive ? `按「${PLAN_NAMES[trial.mode]}」策略遍历全部 ${trial.totalCount} 种组合，推荐方案为当前清单下的全局最优。` : `按「${PLAN_NAMES[trial.mode]}」策略评估 ${trial.evaluatedCount}/${trial.totalCount} 种组合，受计算预算限制，以下为已找到的最优可行方案，不代表全局最优。` }}
      </p>
      <p v-if="!trial.complete" class="trial-warning">未满足的必带组：{{ trial.unsatisfiedGroups.join('、') }}</p>
      <article v-if="trial.recommended" class="trial-best">
        <header><span class="alt-badge recommended">推荐</span><strong>{{ selectionLabel(trial.recommended) }}</strong></header>
        <p>装入 {{ trial.recommended.plan.placements.length }} 件 · 已装 {{ trial.recommended.plan.totalWeight.toFixed(1) }} kg · 重量余量 {{ trial.recommended.weightMargin.toFixed(1) }} kg · 偏好得分 {{ trial.recommended.preferenceScore }}</p>
      </article>
      <article v-for="(candidate, index) in otherCandidates" :key="index" class="trial-candidate">
        <strong>{{ selectionLabel(candidate) }}</strong>
        <p class="candidate-reason">放弃原因：{{ candidate.dropReason }}</p>
      </article>
      <p v-if="hiddenCount" class="alt-hint">其余 {{ hiddenCount }} 种组合均不优于推荐方案，从略。</p>
    </div>
  </section>
</template>
