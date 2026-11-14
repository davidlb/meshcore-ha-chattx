"""Tests for reactions (MeshCore One format)."""

from datetime import datetime, timezone

from custom_components.meshcore_chattx.message_store import (
    _add_reaction,
    _find_reaction_target,
)
from custom_components.meshcore_chattx.reactions import (
    SenderTimeCache,
    build_reaction,
    channel_text,
    is_single_emoji,
    message_hash,
    parse_reaction,
)


def _iso(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def test_hash_matches_the_spec_example():
    assert message_hash("Hello", 1_704_067_200) == "b45pc4ek"


def test_parse_channel_both_orders_and_direct():
    new = parse_reaction("@[Alpha]👍\nb45pc4ek", True)
    old = parse_reaction("👍@[Alpha]\nB45PC4EK", True)
    assert new == old
    assert new.target_sender == "Alpha" and new.message_hash == "b45pc4ek"
    dm = parse_reaction("❤️\nb45pc4ek", False)
    assert dm.emoji == "❤️" and dm.target_sender is None


def test_ordinary_chat_is_not_a_reaction():
    assert parse_reaction("👍 fajn\nb45pc4ek", False) is None
    assert parse_reaction("ahoj\nabcdefgh", False) is None
    assert parse_reaction("@[Alpha]👍 díky\nb45pc4ek", True) is None
    assert parse_reaction("@[Alpha]👍\nb45pc4ek", False) is None


def test_single_emoji():
    for emoji in ("👍", "👍🏽", "❤️", "🇨🇿", "👨‍👩‍👧", "1️⃣"):
        assert is_single_emoji(emoji)
    for text in ("a", "👍👍", ":)", ""):
        assert not is_single_emoji(text)


def test_build_round_trip():
    text = build_reaction("👍", "b45pc4ek", "Alpha")
    assert text == "@[Alpha]👍\nb45pc4ek"
    assert parse_reaction(text, True).target_sender == "Alpha"
    assert build_reaction("👍", "b45pc4ek", None) == "👍\nb45pc4ek"


def test_channel_text_strips_the_sender():
    assert channel_text("Alpha: Hello ") == "Hello"
    assert channel_text("no prefix") == "no prefix"


def test_sender_time_cache():
    cache = SenderTimeCache()
    key = SenderTimeCache.channel_key(3, "Hello")
    cache.put(key, 1_704_067_200)
    assert cache.pop(key) == 1_704_067_200
    assert cache.pop(key) is None


def test_target_by_known_sender_time():
    target = {"sender": "Alpha", "text": "Hello", "sender_timestamp": 1_704_067_200,
              "timestamp": _iso(1_704_067_201)}
    other = {"sender": "Beta", "text": "Hello", "sender_timestamp": 1_704_067_200,
             "timestamp": _iso(1_704_067_201)}
    parsed = parse_reaction("@[Alpha]👍\nb45pc4ek", True)
    assert _find_reaction_target([target, other], parsed) is target


def test_target_by_time_near_our_own_send():
    own = {"sender": "Me", "text": "Hello", "outgoing": True, "timestamp": _iso(1_704_067_212)}
    parsed = parse_reaction("👍\nb45pc4ek", False)
    assert _find_reaction_target([own], parsed) is own
    assert own["sender_timestamp"] == 1_704_067_200


def test_reaction_dedup():
    message = {}
    assert _add_reaction(message, {"emoji": "👍", "sender": "A"})
    assert not _add_reaction(message, {"emoji": "👍", "sender": "A"})
    assert _add_reaction(message, {"emoji": "❤️", "sender": "A"})
