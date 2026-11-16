// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { html, render } from 'lit';
import '../src/components/message-bubble';
import type { ChatMessage, MessageGroup } from '../src/types';

function group(text: string): MessageGroup {
  const msg: ChatMessage = {
    id: 'loc-1', sender: 'Alice', text, timestamp: new Date('2026-11-16T12:00:00Z'),
    isOutgoing: false, isSystem: false, raw: text, mentions: [],
  };
  return { sender: 'Alice', isOutgoing: false, isSystem: false, messages: [msg], startTime: msg.timestamp, endTime: msg.timestamp };
}

async function mount(text: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(html`<chattx-message-bubble .group=${group(text)}></chattx-message-bubble>`, container);
  const bubble = container.querySelector('chattx-message-bubble') as HTMLElement & { updateComplete: Promise<unknown> };
  await bubble.updateComplete;
  return bubble;
}

describe('locations in bubbles', () => {
  it('turns a pinned location into a map link', async () => {
    const bubble = await mount('Meet here 📍 49.74512,13.37722 ok');
    const links = [...bubble.shadowRoot!.querySelectorAll('a.location')];
    expect(links.map((a) => a.textContent)).toEqual(['📍 49.74512,13.37722']);
    expect(bubble.shadowRoot!.querySelector('.mecp')).toBeNull();
  });

  it('shows an MECP message with its severity and its bare coordinates as a link', async () => {
    const bubble = await mount('MECP/0/M01 M07 2pax P05 48.6520,20.1305');
    expect(bubble.shadowRoot!.querySelector('.mecp')!.textContent).toContain('MECP MAYDAY');
    expect([...bubble.shadowRoot!.querySelectorAll('a.location')].map((a) => a.textContent)).toEqual(['48.6520,20.1305']);
  });

  it('leaves bare numbers alone outside MECP', async () => {
    const bubble = await mount('score was 48.6520,20.1305');
    expect(bubble.shadowRoot!.querySelector('a.location')).toBeNull();
  });
});
