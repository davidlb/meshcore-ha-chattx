"""Emoji reactions on messages, compatible with MeshCore One.

A reaction is an ordinary mesh message in a fixed text format that points
at its target by a hash of the target's text and the sender's original
timestamp (see MeshCore One docs/Reactions.md):

    channel:  @[{target sender}]{emoji}\\n{hash}   (older: {emoji}@[{sender}]\\n{hash})
    direct:   {emoji}\\n{hash}

    hash = Crockford Base32(SHA-256(UTF-8(text) + LE uint32(sender timestamp))[:5])

The sender timestamp is the time the sending radio put into the packet.
meshcore-ha does not pass it on in its message event, so ``SenderTimeCache``
takes it from the radio's own receive events, which arrive before
meshcore-ha fires that event.
"""

from __future__ import annotations

import hashlib
import struct
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Any

_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
_DECODE = {c: i for i, c in enumerate(_ALPHABET)}
_DECODE.update({c.upper(): i for c, i in list(_DECODE.items())})
_DECODE.update({"O": 0, "o": 0, "I": 1, "i": 1, "L": 1, "l": 1})

HASH_LENGTH = 8


def message_hash(text: str, sender_timestamp: int) -> str:
    """The 8-character reaction hash of a message."""
    data = text.encode("utf-8") + struct.pack("<I", int(sender_timestamp) & 0xFFFFFFFF)
    digest = hashlib.sha256(data).digest()[:5]
    bits = int.from_bytes(digest, "big")
    return "".join(_ALPHABET[(bits >> shift) & 0x1F] for shift in range(35, -1, -5))


def _normalize_hash(raw: str) -> str | None:
    if len(raw) != HASH_LENGTH or any(c not in _DECODE for c in raw):
        return None
    return "".join(_ALPHABET[_DECODE[c]] for c in raw)


# Code points that only modify the emoji before them.
_MODIFIERS = {0xFE0E, 0xFE0F, 0x20E3}


def _is_modifier(cp: int) -> bool:
    return cp in _MODIFIERS or 0x1F3FB <= cp <= 0x1F3FF or 0xE0020 <= cp <= 0xE007F


def _is_regional(cp: int) -> bool:
    return 0x1F1E6 <= cp <= 0x1F1FF


def _is_pictographic(ch: str) -> bool:
    cp = ord(ch)
    if _is_regional(cp):
        return True
    if cp >= 0x1F000:
        return True
    if 0x2100 <= cp <= 0x2BFF or 0x3000 <= cp <= 0x303F or cp in (0x3297, 0x3299, 0xA9, 0xAE):
        return unicodedata.category(ch) == "So" or cp in (0xA9, 0xAE)
    return False


def is_single_emoji(value: str) -> bool:
    """True when ``value`` is exactly one emoji (one grapheme cluster)."""
    if not value or len(value) > 20:
        return False
    chars = list(value)
    first = ord(chars[0])
    # Keycaps: 0-9 # * followed by FE0F? and 20E3.
    if chars[0] in "0123456789#*":
        rest = [ord(c) for c in chars[1:]]
        return rest in ([0x20E3], [0xFE0F, 0x20E3])
    if not _is_pictographic(chars[0]):
        return False
    if _is_regional(first):
        return len(chars) == 2 and _is_regional(ord(chars[1]))
    i = 1
    while i < len(chars):
        cp = ord(chars[i])
        if _is_modifier(cp):
            i += 1
            continue
        if cp == 0x200D and i + 1 < len(chars) and _is_pictographic(chars[i + 1]):
            i += 2
            continue
        return False
    return True


@dataclass(frozen=True)
class ParsedReaction:
    """A reaction found in a message text."""

    emoji: str
    message_hash: str
    target_sender: str | None  # channel reactions only


def parse_reaction(text: str, is_channel: bool) -> ParsedReaction | None:
    """The reaction in ``text``, or None when it is ordinary chat."""
    if not text or "\n" not in text:
        return None
    head, _, raw_hash = text.rpartition("\n")
    msg_hash = _normalize_hash(raw_hash)
    if msg_hash is None:
        return None
    if not is_channel:
        if "@[" in head or not is_single_emoji(head):
            return None
        return ParsedReaction(head, msg_hash, None)
    at = head.find("@[")
    if at < 0:
        return None
    before, after = head[:at], head[at + 2:]
    if not before:
        close = after.find("]")
        if close < 0:
            return None
        sender, emoji = after[:close], after[close + 1:]
    else:
        if not after.endswith("]"):
            return None
        emoji, sender = before, after[:-1]
    if not sender or not is_single_emoji(emoji):
        return None
    return ParsedReaction(emoji, msg_hash, sender)


def build_reaction(emoji: str, msg_hash: str, target_sender: str | None) -> str:
    """The wire text of a reaction (channel when ``target_sender`` is given)."""
    if target_sender is not None:
        return f"@[{target_sender}]{emoji}\n{msg_hash}"
    return f"{emoji}\n{msg_hash}"


def channel_text(raw: str) -> str:
    """The text of a raw channel payload "Name: text", as meshcore-ha stores it."""
    name, sep, text = (raw or "").partition(": ")
    return text.strip() if sep and name.strip() else raw


class SenderTimeCache:
    """Sender timestamps of just-received messages, until their HA event arrives."""

    TTL = 120.0

    def __init__(self) -> None:
        self._items: dict[tuple, list[tuple[float, int]]] = {}

    @staticmethod
    def channel_key(channel_idx: Any, text: str) -> tuple:
        return ("ch", str(channel_idx), text.strip())

    @staticmethod
    def direct_key(pubkey_prefix: Any, text: str) -> tuple:
        return ("dm", str(pubkey_prefix or "")[:12].lower(), text.strip())

    def put(self, key: tuple, sender_timestamp: Any) -> None:
        if not isinstance(sender_timestamp, int) or sender_timestamp <= 0:
            return
        now = time.monotonic()
        self._expire(now)
        self._items.setdefault(key, []).append((now, sender_timestamp))

    def pop(self, key: tuple) -> int | None:
        self._expire(time.monotonic())
        entries = self._items.get(key)
        if not entries:
            return None
        _, ts = entries.pop(0)
        if not entries:
            del self._items[key]
        return ts

    def _expire(self, now: float) -> None:
        for key in [k for k, v in self._items.items() if now - v[-1][0] > self.TTL]:
            del self._items[key]


def known_sender_timestamps(message: dict) -> list[int]:
    """Sender timestamps this stored message is known to carry."""
    found: list[int] = []
    ts = message.get("sender_timestamp")
    if isinstance(ts, int) and ts > 0:
        found.append(ts)
    for entry in message.get("rx_log_data") or []:
        ts = entry.get("timestamp") if isinstance(entry, dict) else None
        if isinstance(ts, int) and ts > 0 and ts not in found:
            found.append(ts)
    return found


# Our own messages carry our clock: meshcore-ha stamps them with time.time()
# when sending and fires its event after a few seconds of collecting repeats.
_OWN_WINDOW = range(-60, 6)
# A received message without a known sender time: the sender's clock is
# usually close to ours, so try a short window around the receive time.
_RECEIVED_WINDOW = range(-90, 6)


def _receive_epoch(message: dict) -> int | None:
    try:
        return int(datetime.fromisoformat(str(message.get("timestamp"))).timestamp())
    except (TypeError, ValueError):
        return None


def message_hashes(message: dict) -> list[str]:
    """Exact reaction hashes of a stored message (from known sender times)."""
    text = message.get("text") or ""
    return [message_hash(text, ts) for ts in known_sender_timestamps(message)]


def guessed_timestamp(message: dict, msg_hash: str) -> int | None:
    """The sender timestamp that gives ``msg_hash``, searched near the receive time."""
    base = _receive_epoch(message)
    if base is None:
        return None
    text = message.get("text") or ""
    window = _OWN_WINDOW if message.get("outgoing") else _RECEIVED_WINDOW
    for delta in window:
        if message_hash(text, base + delta) == msg_hash:
            return base + delta
    return None


def reaction_sender_timestamp(message: dict) -> int | None:
    """The sender timestamp to hash when reacting to ``message``."""
    known = known_sender_timestamps(message)
    return known[0] if known else None
