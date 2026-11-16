/** Firmware MAX_TEXT_LEN: the limit is in UTF-8 bytes, not characters. */
const MAX_MESSAGE_BYTES = 160;

/** A long text is sent in at most this many messages. */
export const MAX_MESSAGE_PARTS = 5;

const encoder = new TextEncoder();

function bytes(text: string): number {
  return encoder.encode(text).length;
}

function prefixBytes(channelSender: string | null): number {
  return channelSender === null ? 0 : bytes(`${channelSender}: `);
}

/**
 * Bytes left in a message. Firmware sends channel messages as
 * "<sender>: <text>", so the sender's name and ": " use up the limit there;
 * direct messages carry only the text. Negative when the text is too long.
 */
export function remainingMessageBytes(text: string, channelSender: string | null): number {
  return MAX_MESSAGE_BYTES - prefixBytes(channelSender) - bytes(text.trim());
}

/** Cut a word that alone is longer than `budget` bytes, between characters. */
function cutWord(word: string, budget: number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (bytes(piece + ch) > budget && piece) {
      pieces.push(piece);
      piece = '';
    }
    piece += ch;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Fill parts of at most `budget` bytes with whole words where possible. The
 * spaces and line breaks between words are kept, except where a part ends.
 */
function fill(text: string, budget: number): string[] {
  const parts: string[] = [];
  let current = '';
  let gap = '';
  for (const token of text.split(/(\s+)/)) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      gap = token;
      continue;
    }
    for (const piece of bytes(token) > budget ? cutWord(token, budget) : [token]) {
      const next = current ? current + gap + piece : piece;
      if (bytes(next) <= budget) {
        current = next;
      } else {
        parts.push(current);
        current = piece;
      }
      gap = '';
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * A text too long for one message, split into numbered messages that each
 * fit: "… 1/3", "… 2/3", "… 3/3". Null when it fits in one message or would
 * need more than MAX_MESSAGE_PARTS.
 */
export function splitMessage(text: string, channelSender: string | null): string[] | null {
  const trimmed = text.trim();
  if (remainingMessageBytes(trimmed, channelSender) >= 0) return null;
  const room = MAX_MESSAGE_BYTES - prefixBytes(channelSender);
  for (let count = 2; count <= MAX_MESSAGE_PARTS; count++) {
    const budget = room - bytes(` ${count}/${count}`);
    if (budget < 8) return null;
    const parts = fill(trimmed, budget);
    if (parts.length <= count) {
      return parts.map((part, i) => `${part} ${i + 1}/${parts.length}`);
    }
  }
  return null;
}
