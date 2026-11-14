import { describe, expect, it } from 'vitest';
import { groupReactions, isReactionText, isSingleEmoji } from '../src/utils/reactions';

describe('reaction text', () => {
  it('recognises channel reactions in both orders', () => {
    expect(isReactionText('@[Alpha]👍\nb45pc4ek', true)).toBe(true);
    expect(isReactionText('👍@[Alpha]\nB45PC4EK', true)).toBe(true);
  });

  it('recognises direct reactions', () => {
    expect(isReactionText('❤️\nb45pc4ek', false)).toBe(true);
    expect(isReactionText('@[Alpha]👍\nb45pc4ek', false)).toBe(false);
  });

  it('leaves ordinary chat alone', () => {
    expect(isReactionText('👍 fajn\nb45pc4ek', false)).toBe(false);
    expect(isReactionText('ahoj\nabcdefgh', false)).toBe(false);
    expect(isReactionText('@[Alpha]👍 díky\nb45pc4ek', true)).toBe(false);
    expect(isReactionText('@[Alpha]👍\nb45pc4e', true)).toBe(false);
    expect(isReactionText('@[Alpha] ahoj', true)).toBe(false);
  });

  it('accepts one emoji only', () => {
    for (const e of ['👍', '👍🏽', '❤️', '🇨🇿', '👨‍👩‍👧', '1️⃣']) expect(isSingleEmoji(e)).toBe(true);
    for (const e of ['a', '👍👍', ':)', '']) expect(isSingleEmoji(e)).toBe(false);
  });
});

describe('groupReactions', () => {
  it('groups by emoji, most frequent first, and marks our own', () => {
    const groups = groupReactions([
      { emoji: '❤️', sender: 'A', time: '' },
      { emoji: '👍', sender: 'B', time: '' },
      { emoji: '👍', sender: 'Me', time: '', outgoing: true },
    ]);
    expect(groups.map((g) => [g.emoji, g.count, g.own])).toEqual([['👍', 2, true], ['❤️', 1, false]]);
  });
});
