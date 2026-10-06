import { describe, expect, it } from 'vitest';
import { defaultSelection, effectiveItems, evaluateAlternatives, fingerprintOf, pruneGroups, validateGroupDraft } from '../alternative-engine';
import type { AlternativeGroup, PackingItem, Suitcase } from '../models';

const box: Suitcase = { length: 20, width: 10, height: 10, maxWeight: 10 };
const item = (id: string, overrides: Partial<PackingItem> = {}): PackingItem => ({ id, name: id, category: '衣物', length: 4, width: 2, height: 2, weight: 1, priority: 1, mustHave: false, ...overrides });
const group = (id: string, itemIds: string[], required = true): AlternativeGroup => ({ id, name: id, itemIds, required });

describe('validateGroupDraft', () => {
  it('rejects optional groups containing a must-have item', () => {
    const items = [item('a', { mustHave: true }), item('b')];
    expect(validateGroupDraft(group('g', ['a', 'b'], false), items, []).join()).toContain('不能设为可选');
    expect(validateGroupDraft(group('g', ['a', 'b'], true), items, [])).toEqual([]);
  });

  it('rejects groups with fewer than two members or overlapping membership', () => {
    const items = [item('a'), item('b'), item('c')];
    expect(validateGroupDraft(group('g1', ['a']), items, []).join()).toContain('至少需要两件');
    expect(validateGroupDraft(group('g2', ['a', 'b']), items, [group('g1', ['a', 'c'])]).join()).toContain('已属于分组');
  });
});

describe('effectiveItems', () => {
  const items = [item('x'), item('a'), item('b'), item('c'), item('d')];
  const groups = [group('g1', ['a', 'b']), group('g2', ['c', 'd'], false)];

  it('keeps at most one item per group and defaults to the top preference', () => {
    const result = effectiveItems(items, groups, []);
    expect(result.map((entry) => entry.id).sort()).toEqual(['a', 'c', 'x']);
  });

  it('honours explicit selections including opting out of optional groups', () => {
    const result = effectiveItems(items, groups, [{ groupId: 'g1', itemId: 'b' }, { groupId: 'g2', itemId: null }]);
    expect(result.map((entry) => entry.id).sort()).toEqual(['b', 'x']);
  });

  it('returns independent copies that do not share references with the source list', () => {
    const result = effectiveItems(items, groups, []);
    result[0].weight = 99;
    expect(items.find((entry) => entry.id === result[0].id)?.weight).not.toBe(99);
  });
});

describe('defaultSelection', () => {
  it('defaults each group to its most preferred member', () => {
    expect(defaultSelection([group('g1', ['a', 'b']), group('g2', ['c', 'd'], false)]))
      .toEqual([{ groupId: 'g1', itemId: 'a' }, { groupId: 'g2', itemId: 'c' }]);
  });
});

describe('evaluateAlternatives', () => {
  it('prefers candidates that satisfy required groups over in-group preference', () => {
    const items = [item('a', { length: 25, width: 10, height: 10 }), item('b')];
    const result = evaluateAlternatives(box, items, [group('g', ['a', 'b'])], 'comfort');
    expect(result.recommended?.selection).toEqual([{ groupId: 'g', itemId: 'b' }]);
    expect(result.complete).toBe(true);
    expect(result.exhaustive).toBe(true);
    const dropped = result.candidates.find((candidate) => candidate.selection[0].itemId === 'a');
    expect(dropped?.dropReason).toContain('必带组');
  });

  it('breaks ties by in-group preference', () => {
    const items = [item('a'), item('b')];
    const result = evaluateAlternatives(box, items, [group('g', ['a', 'b'])], 'comfort');
    expect(result.recommended?.selection[0].itemId).toBe('a');
    const dropped = result.candidates.find((candidate) => candidate.selection[0].itemId === 'b');
    expect(dropped?.dropReason).toContain('偏好');
  });

  it('uses weight margin as the final tie-breaker', () => {
    const tightBox: Suitcase = { length: 20, width: 10, height: 10, maxWeight: 3.5 };
    const items = [item('a1', { weight: 2 }), item('a2', { weight: 0.5 }), item('b1', { weight: 2 }), item('b2', { weight: 1 })];
    const groups = [group('g1', ['a1', 'a2']), group('g2', ['b1', 'b2'])];
    const result = evaluateAlternatives(tightBox, items, groups, 'comfort');
    expect(result.recommended?.selection).toEqual([{ groupId: 'g1', itemId: 'a2' }, { groupId: 'g2', itemId: 'b1' }]);
    const dropped = result.candidates.find((candidate) => candidate.selection[0].itemId === 'a1' && candidate.selection[1].itemId === 'b2');
    expect(dropped?.dropReason).toContain('重量余量');
  });

  it('stops at the evaluation budget and does not claim an exhaustive search', () => {
    const items = [item('a'), item('b'), item('c'), item('d'), item('e'), item('f')];
    const groups = [group('g1', ['a', 'b']), group('g2', ['c', 'd']), group('g3', ['e', 'f'])];
    const result = evaluateAlternatives(box, items, groups, 'comfort', 3);
    expect(result.evaluatedCount).toBe(3);
    expect(result.totalCount).toBe(8);
    expect(result.exhaustive).toBe(false);
    expect(result.recommended).not.toBeNull();
  });

  it('marks unsatisfied required groups when no complete solution exists', () => {
    const items = [item('a', { length: 25, width: 10, height: 10 }), item('b', { length: 25, width: 10, height: 10 })];
    const result = evaluateAlternatives(box, items, [group('g', ['a', 'b'])], 'comfort');
    expect(result.complete).toBe(false);
    expect(result.unsatisfiedGroups).toEqual(['g']);
  });

  it('evaluates on independent copies without mutating the source list', () => {
    const items = [item('a'), item('b')];
    const snapshot = JSON.stringify(items);
    evaluateAlternatives(box, items, [group('g', ['a', 'b'])], 'comfort');
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe('pruneGroups', () => {
  it('drops removed items and dissolves groups below two members', () => {
    const groups = [group('g1', ['a', 'b']), group('g2', ['c', 'd'], false)];
    const selection = [{ groupId: 'g1', itemId: 'a' }, { groupId: 'g2', itemId: 'd' }];
    const pruned = pruneGroups(groups, selection, [item('a'), item('c'), item('d')]);
    expect(pruned.dissolved).toEqual(['g1']);
    expect(pruned.groups.map((entry) => entry.id)).toEqual(['g2']);
    expect(pruned.selection).toEqual([{ groupId: 'g2', itemId: 'd' }]);
  });
});

describe('fingerprintOf', () => {
  it('changes when the item list changes', () => {
    const items = [item('a'), item('b')];
    const groups = [group('g', ['a', 'b'])];
    expect(fingerprintOf(box, items, groups)).not.toBe(fingerprintOf(box, [...items, item('c')], groups));
  });
});
