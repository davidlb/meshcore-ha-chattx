/**
 * Name suggestions after "@" in the composer.
 *
 * Typing "@al" offers "Alice 📟", "Alkel Brostl", … from the radio's contacts
 * (every node it has an advert from) and the people of the open conversation;
 * picking one turns the typed text into
 * "@[Alice 📟] ", the MeshCore mention form.
 */

export interface NameCandidate {
  name: string;
  /** Higher comes first among equally good matches. */
  weight: number;
}

/** The "@…" being typed right before the cursor. */
export interface MentionQuery {
  /** Index of the "@". */
  start: number;
  /** The text typed after "@" (or "@["), maybe empty. */
  query: string;
}

const MAX_QUERY = 32;

/**
 * The mention being typed at the cursor, or null. "@" must start the text or
 * follow a space or line break. Without a bracket the name ends at a space;
 * after "@[" spaces are allowed until "]".
 */
export function mentionAt(text: string, cursor: number): MentionQuery | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf('@');
  if (at < 0 || cursor - at - 1 > MAX_QUERY) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  let query = before.slice(at + 1);
  if (query.startsWith('[')) {
    query = query.slice(1);
    if (/[\]\n@]/.test(query)) return null;
  } else if (/[\s@]/.test(query)) {
    return null;
  }
  return { start: at, query };
}

/** Lower case without diacritics, for matching "zdenek" with "Zdeněk". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Names matching the query: the start of the name first, then the start of
 * one of its words, then anywhere in it; heavier candidates first within
 * each group. An empty query lists the heaviest.
 */
export function suggestNames(query: string, candidates: NameCandidate[], limit = 8): string[] {
  const q = fold(query.trim());
  const scored: Array<{ name: string; tier: number; weight: number }> = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c.name || seen.has(c.name)) continue;
    seen.add(c.name);
    const n = fold(c.name);
    let tier: number;
    if (!q || n.startsWith(q)) tier = 0;
    else if (n.split(/[\s._\-/]+/).some((w) => w.startsWith(q))) tier = 1;
    else if (n.includes(q)) tier = 2;
    else continue;
    scored.push({ name: c.name, tier, weight: c.weight });
  }
  scored.sort((a, b) => a.tier - b.tier || b.weight - a.weight || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.name);
}

/** Replace the typed "@…" with "@[name] "; returns the new text and cursor. */
export function insertMention(text: string, mention: MentionQuery, cursor: number, name: string): { text: string; cursor: number } {
  const inserted = `@[${name}] `;
  let end = cursor;
  // A "]" right after the cursor belongs to the mention being replaced.
  if (text.slice(mention.start + 1, mention.start + 2) === '[' && text[end] === ']') end += 1;
  if (text[end] === ' ') end += 1;
  return { text: text.slice(0, mention.start) + inserted + text.slice(end), cursor: mention.start + inserted.length };
}

/**
 * Candidates: the radio's contacts (every node it has an advert from, added
 * or only discovered) and everyone who wrote in the open conversation, also
 * without an advert. People from the conversation come first (the latest
 * sender on top), then companions, room servers and sensors, repeaters last.
 */
export function buildCandidates(
  contacts: Array<{ name: string; type?: number }>,
  conversationSenders: string[],
  ownName: string,
): NameCandidate[] {
  const typeWeight: Record<number, number> = { 1: 30, 3: 20, 4: 10, 2: 0 };
  const recent = new Map(conversationSenders.map((name, i) => [name, 1000 - i]));
  const out: NameCandidate[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    if (!c.name || c.name === ownName || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ name: c.name, weight: (recent.get(c.name) ?? 0) + (typeWeight[c.type ?? 1] ?? 0) });
  }
  for (const [name, weight] of recent) {
    if (!name || name === ownName || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, weight: weight + typeWeight[1] });
  }
  return out;
}
