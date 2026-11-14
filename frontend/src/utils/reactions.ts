/**
 * Emoji reactions (MeshCore One format, docs/Reactions.md).
 *
 * The backend recognises reactions, keeps them on their message and builds
 * the text to send. The panel only needs to know a reaction when one
 * arrives live, so it does not show it as a chat bubble.
 */

import type { MessageReaction } from '../types';

/** Quick reactions offered in the message dialog. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const HASH = /^[0-9a-hjkmnp-tv-zA-HJKMNP-TV-ZoOiIlL]{8}$/;
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const KEYCAP = /^[0-9#*]️?⃣$/u;

/** True when `value` is exactly one emoji (one grapheme cluster). */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > 20) return false;
  if (KEYCAP.test(value)) return true;
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (Segmenter) {
    const graphemes = [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
    if (graphemes.length !== 1) return false;
  }
  return PICTOGRAPHIC.test(value) && !/[\s\p{L}\p{N}]/u.test(value.replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[︎️‍⃣\u{E0020}-\u{E007F}]/gu, ''));
}

/** True when a message text is a reaction rather than chat. */
export function isReactionText(text: string, isChannel: boolean): boolean {
  if (!text) return false;
  const nl = text.lastIndexOf('\n');
  if (nl < 0 || !HASH.test(text.slice(nl + 1))) return false;
  const head = text.slice(0, nl);
  if (!isChannel) return !head.includes('@[') && isSingleEmoji(head);
  const at = head.indexOf('@[');
  if (at < 0) return false;
  const before = head.slice(0, at);
  const after = head.slice(at + 2);
  if (!before) {
    const close = after.indexOf(']');
    return close > 0 && isSingleEmoji(after.slice(close + 1));
  }
  return after.endsWith(']') && after.length > 1 && isSingleEmoji(before);
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  senders: string[];
  /** One of them is ours. */
  own: boolean;
}

/** Reactions grouped by emoji, the most frequent first. */
export function groupReactions(reactions: MessageReaction[] | undefined): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const r of reactions ?? []) {
    let g = groups.get(r.emoji);
    if (!g) {
      g = { emoji: r.emoji, count: 0, senders: [], own: false };
      groups.set(r.emoji, g);
    }
    g.count += 1;
    g.senders.push(r.sender);
    if (r.outgoing) g.own = true;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
