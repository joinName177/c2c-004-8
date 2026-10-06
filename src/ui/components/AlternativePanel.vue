<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AlternativeCandidate, AlternativeGroup, AlternativeTrial, PackingItem } from '../../core/models';

const props = defineProps<{
  groups: AlternativeGroup[];
  items: PackingItem[];
  trial: AlternativeTrial | null;
  invalid: boolean;
}>();
const emit = defineEmits<{
  addGroup: [name: string];
  removeGroup: [id: string];
  setRequired: [id: string, required: boolean];
  addMember: [groupId: string, itemId: string];
  removeMember: [groupId: string, itemId: string];
  moveMember: [groupId: string, itemId: string, delta: number];
  run: [];
  confirm: [];
}>();

const draftName = ref('');
const itemById = computed(() => new Map(props.items.map((item) => [item.id, item])));
const groupById = computed(() => new Map(props.groups.map((group) => [group.id, group])));
const ungroupedItems = computed(() => {
  const grouped = new Set(props.groups.flatMap((group) => group.members.map((member) => member.itemId)));
  return props.items.filter((item) => !grouped.has(item.id));
});
const canRun = computed(() => props.groups.some((group) => group.members.length > 0));

const itemName = (id: string) => itemById.value.get(id)?.name ?? '已删除物品';
const groupName = (id: string) => groupById.value.get(id)?.name ?? '未知组合';
const sortedMembers = (group: AlternativeGroup) => [...group.members].sort((a, b) => a.preference - b.preference);
const hasMustHave = (group: AlternativeGroup) => group.members.some((member) => itemById.value.get(member.itemId)?.mustHave);

function create() {
  emit('addGroup', draftName.value);
  draftName.value = '';
}
function pickMember(groupId: string, event: Event) {
  const select = event.target as HTMLSelectElement;
  if (select.value) emit('addMember', groupId, select.value);
  select.value = '';
}
function describe(candidate: AlternativeCandidate) {
  return candidate.choices
    .map((choice) => `${groupName(choice.groupId)}→${choice.itemId ? itemName(choice.itemId) : '不携带'}`)
    .join('，');
}
</script>

<template>
  <section class="panel alternatives">
    <div class="section-title"><div><span>ALTERNATIVES</span><h2>替代组合试算</h2></div><b>{{ groups.length }} 组</b></div>
    <p class="alt-hint">把可互相替代的物品放进一组，系统每组最多选一件，按当前策略试装比较。</p>
    <form class="group-creator" data-testid="group-creator" @submit.prevent="create">
      <input v-model="draftName" aria-label="组合名称" placeholder="如：外套二选一" />
      <button type="submit">＋ 建组</button>
    </form>

    <article v-for="group in groups" :key="group.id" class="group-card" :data-group="group.id">
      <header>
        <strong>{{ group.name }}</strong>
        <div class="group-mode" role="group" :aria-label="`${group.name} 必带设置`">
          <button type="button" :class="{ on: group.required }" @click="emit('setRequired', group.id, true)">必带组</button>
          <button
            type="button"
            :class="{ on: !group.required }"
            :disabled="hasMustHave(group)"
            :title="hasMustHave(group) ? '组内有已标必带的物品，不能改为可选' : ''"
            @click="emit('setRequired', group.id, false)"
          >可选组</button>
        </div>
        <button class="icon-button" type="button" :aria-label="`删除组合 ${group.name}`" @click="emit('removeGroup', group.id)">×</button>
      </header>
      <div v-for="(member, index) in sortedMembers(group)" :key="member.itemId" class="member-row">
        <span class="pref">偏好{{ member.preference }}</span>
        <span>{{ itemName(member.itemId) }}</span>
        <button type="button" :disabled="index === 0" :aria-label="`上移 ${itemName(member.itemId)}`" @click="emit('moveMember', group.id, member.itemId, -1)">↑</button>
        <button type="button" :disabled="index === group.members.length - 1" :aria-label="`下移 ${itemName(member.itemId)}`" @click="emit('moveMember', group.id, member.itemId, 1)">↓</button>
        <button type="button" :aria-label="`移出 ${itemName(member.itemId)}`" @click="emit('removeMember', group.id, member.itemId)">×</button>
      </div>
      <select v-if="ungroupedItems.length" :aria-label="`向${group.name}添加物品`" @change="pickMember(group.id, $event)">
        <option value="">加入物品…</option>
        <option v-for="item in ungroupedItems" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </article>

    <button class="trial-button" type="button" data-testid="run-trial" :disabled="!canRun" @click="emit('run')">开始试算</button>

    <template v-if="trial">
      <p v-if="invalid" class="trial-warning">清单已变化，以下推荐已失效，请重新试算。</p>
      <p v-if="trial.unsatisfiedGroups.length" class="trial-warning" data-testid="unsatisfied-groups">未满足的必带组：{{ trial.unsatisfiedGroups.join('、') }}</p>
      <div class="trial-result" :class="{ invalid }" data-testid="trial-result">
        <p v-if="!trial.exhaustive" class="trial-warning">
          共 {{ trial.totalCombinations }} 种组合，超出计算预算，已评估 {{ trial.evaluated }} 种。以下为预算内最优可行方案，不保证全局最优。
        </p>
        <p v-if="trial.unsatisfiedGroups.length" class="trial-warning">未满足的必带组：{{ trial.unsatisfiedGroups.join('、') }}</p>
        <template v-if="trial.recommended">
          <h3>推荐方案</h3>
          <ul>
            <li v-for="choice in trial.recommended.choices" :key="choice.groupId">
              {{ groupName(choice.groupId) }} → {{ choice.itemId ? itemName(choice.itemId) : '不携带' }}
            </li>
          </ul>
          <p class="reason">{{ trial.recommended.reason }}</p>
          <template v-if="trial.rejected.length">
            <h4>放弃的其他候选</h4>
            <p v-for="(candidate, index) in trial.rejected" :key="index" class="rejected">
              候选{{ index + 1 }}（{{ describe(candidate) }}）：{{ candidate.reason }}
            </p>
          </template>
          <button
            class="confirm-button"
            type="button"
            data-testid="confirm-trial"
            :disabled="invalid || trial.confirmed"
            @click="emit('confirm')"
          >{{ trial.confirmed ? '已采用，三套方案已更新' : '采用推荐方案' }}</button>
        </template>
      </div>
    </template>
  </section>
</template>
