import { describe, expect, it } from 'vitest';
import { buildCandidates, insertMention, mentionAt, suggestNames } from '../src/utils/mentions';

describe('mentionAt', () => {
  it('finds "@…" at the cursor at the start or after a space', () => {
    expect(mentionAt('@al', 3)).toEqual({ start: 0, query: 'al' });
    expect(mentionAt('hi @Bo', 6)).toEqual({ start: 3, query: 'Bo' });
    expect(mentionAt('hi @', 4)).toEqual({ start: 3, query: '' });
  });

  it('ignores e-mail addresses and finished names', () => {
    expect(mentionAt('mail me@home', 12)).toBeNull();
    expect(mentionAt('@al hi', 6)).toBeNull();
    expect(mentionAt('@[Alice] hi', 11)).toBeNull();
  });

  it('allows spaces after "@["', () => {
    expect(mentionAt('@[Alkel Br', 10)).toEqual({ start: 0, query: 'Alkel Br' });
  });
});

describe('suggestNames', () => {
  const c = (name: string, weight = 0) => ({ name, weight });
  it('puts the start of the name first, then word starts, then anywhere, ignoring case and diacritics', () => {
    const names = suggestNames('br', [c('Abra'), c('Alkel Brostl'), c('Brno RPT'), c('Zbranislav')]);
    expect(names).toEqual(['Brno RPT', 'Alkel Brostl', 'Abra', 'Zbranislav']);
    expect(suggestNames('zdenek', [c('Zdeněk K.')])).toEqual(['Zdeněk K.']);
  });

  it('orders equal matches by weight and lists the heaviest for an empty query', () => {
    expect(suggestNames('', [c('A', 1), c('B', 5), c('C', 3)], 2)).toEqual(['B', 'C']);
  });
});

describe('buildCandidates', () => {
  it('leaves out our node and puts people from the conversation first, also without an advert', () => {
    const list = buildCandidates(
      [{ name: 'Hill RPT', type: 2 }, { name: 'Alice', type: 1 }, { name: 'Bob', type: 1 }, { name: 'Me', type: 1 }],
      ['Bob', 'Stranger'],
      'Me',
    );
    expect(suggestNames('', list)).toEqual(['Bob', 'Stranger', 'Alice', 'Hill RPT']);
  });
});

describe('insertMention', () => {
  it('replaces the typed text with the mention form', () => {
    const m = mentionAt('hi @al', 6)!;
    expect(insertMention('hi @al', m, 6, 'Alice 📟')).toEqual({ text: 'hi @[Alice 📟] ', cursor: 15 });
  });

  it('takes a closing bracket and space already there', () => {
    const m = mentionAt('@[Al] x', 4)!;
    expect(insertMention('@[Al] x', m, 4, 'Alice').text).toBe('@[Alice] x');
  });
});

describe('people from the conversation without an advert', () => {
  it('are offered too, before contacts from elsewhere', () => {
    const list = buildCandidates([{ name: 'Alice', type: 1 }, { name: 'Hill RPT', type: 2 }], ['Krysa', 'Alice'], 'Me');
    expect(suggestNames('', list)).toEqual(['Krysa', 'Alice', 'Hill RPT']);
    expect(suggestNames('kr', list)).toEqual(['Krysa']);
  });
});
