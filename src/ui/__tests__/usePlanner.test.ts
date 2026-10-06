import { describe, expect, it } from 'vitest';
import { createSampleSnapshot } from '../../core/sample-data';
import { usePlanner } from '../usePlanner';
import type { PackingSnapshot } from '../../core/models';
import type { PlannerRepository } from '../../ports/planner-repository.port';

class MemoryRepository implements PlannerRepository {
  saved?: PackingSnapshot;
  constructor(private snapshot = createSampleSnapshot()) {}
  load() { return { value: structuredClone(this.snapshot) }; }
  save(snapshot: PackingSnapshot) { this.saved = structuredClone(snapshot); }
}

describe('usePlanner', () => {
  it('adds, updates and removes items while marking results stale', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    const initial = planner.state.items.length;
    planner.addItem({ id: 'new', name: '帽子', category: '衣物', length: 12, width: 12, height: 5, weight: 0.2, priority: 2, mustHave: false });
    expect(planner.state.items).toHaveLength(initial + 1);
    expect(planner.isStale.value).toBe(true);
    planner.updateItem('new', { name: '遮阳帽' });
    expect(planner.state.items.find((item) => item.id === 'new')?.name).toBe('遮阳帽');
    planner.removeItem('new');
    expect(planner.state.items).toHaveLength(initial);
  });

  it('regenerates plans and persists the selected mode', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.updateSuitcase({ maxWeight: 12 });
    expect(planner.isStale.value).toBe(true);
    planner.regenerate();
    planner.selectPlan('shopping');
    expect(planner.isStale.value).toBe(false);
    expect(planner.plans.value.shopping.name).toBe('购物版');
    expect(repository.saved?.selectedPlan).toBe('shopping');
  });

  it('runs a trial on an independent copy and confirms the recommended selection', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.runTrial();
    const trial = planner.trial.value;
    expect(trial?.recommended).not.toBeNull();
    const itemsBefore = JSON.stringify(planner.state.items);
    planner.confirmTrial();
    expect(JSON.stringify(planner.state.items)).toBe(itemsBefore);
    expect(repository.saved?.alternativeSelection).toEqual(trial?.recommended?.selection);
    expect(planner.isStale.value).toBe(false);
    const chosen = new Set(trial?.recommended?.selection.map((entry) => entry.itemId).filter(Boolean));
    for (const group of planner.state.alternativeGroups) {
      for (const plan of Object.values(planner.plans.value)) {
        const placed = new Set(plan.placements.map((placement) => placement.itemId));
        const fromGroup = group.itemIds.filter((id) => placed.has(id));
        expect(fromGroup.length).toBeLessThanOrEqual(1);
        expect(fromGroup.every((id) => chosen.has(id))).toBe(true);
      }
    }
  });

  it('invalidates the trial recommendation once the list changes', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.runTrial();
    expect(planner.trialStale.value).toBe(false);
    planner.addItem({ id: 'extra', name: '充电宝', category: '数码', length: 10, width: 6, height: 2, weight: 0.2, priority: 2, mustHave: false });
    expect(planner.trialStale.value).toBe(true);
    const selectionBefore = JSON.stringify(planner.state.alternativeSelection);
    planner.confirmTrial();
    expect(JSON.stringify(planner.state.alternativeSelection)).toBe(selectionBefore);
  });

  it('auto-upgrades an optional group when a member becomes must-have', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    expect(planner.state.alternativeGroups.find((group) => group.id === 'grp-photo')?.required).toBe(false);
    planner.updateItem('camera', { mustHave: true });
    expect(planner.state.alternativeGroups.find((group) => group.id === 'grp-photo')?.required).toBe(true);
  });

  it('blocks turning a group with must-have members into optional', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    const outerwear = planner.state.alternativeGroups.find((group) => group.id === 'grp-outerwear');
    expect(outerwear).toBeDefined();
    const errors = planner.saveGroup({ ...outerwear!, required: false });
    expect(errors.length).toBeGreaterThan(0);
    expect(planner.state.alternativeGroups.find((group) => group.id === 'grp-outerwear')?.required).toBe(true);
  });

  it('dissolves a group when a member is removed from the list', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.removeItem('coat-heavy');
    expect(planner.state.alternativeGroups.find((group) => group.id === 'grp-outerwear')).toBeUndefined();
    expect(planner.state.alternativeSelection.some((entry) => entry.groupId === 'grp-outerwear')).toBe(false);
  });
});
