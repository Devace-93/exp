"""exp's own feature switches ("features" in the API, to keep them apart from
the product's flags). Source of truth: PostHog; registry + fail-safe defaults
live in ``packages/shared/feature_flags.json``.

Resolution order:

0. ``FEATURE_FLAG_OVERRIDES="signups=off,site-building=on"`` pins a switch
   regardless of everything else. Meant for local development and CI, where
   the PostHog project is the production one and you still need e.g. signups
   on. Never set it in production.
1. Self-host (``POSTHOG_API_KEY`` unset) — the registry's ``self_host`` value
   (ON unless the switch says otherwise; inverse-polarity switches such as
   ``site-building`` opt out explicitly). Zero network.
2. Hosted with PostHog reachable — whatever the PostHog dashboard says,
   evaluated locally (definitions polled in the background, ~0ms per call).
   Requires ``POSTHOG_PERSONAL_API_KEY`` for local evaluation.
3. PostHog unreachable / flag undefined there / personal key missing — the
   per-switch ``default`` from the shared registry.

One PostHog project is shared with the other 3m4 apps, so the PostHog flag key
is ``config.posthog_flag_prefix + key`` (``exp-signups``). Registry keys, the
API and the overrides all use the unprefixed key.

Switch checks must never add request latency or raise: any failure falls back
to the registry default.
"""
from __future__ import annotations

import os

from ._shared import load_shared
from .config import config


def _overrides() -> dict[str, bool]:
    raw = os.getenv("FEATURE_FLAG_OVERRIDES", "").strip()
    out: dict[str, bool] = {}
    for item in raw.split(","):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        out[key.strip()] = value.strip().lower() in {"1", "true", "yes", "on"}
    return out


_client = None
_client_ready = False


def registry() -> dict:
    """The shared switch registry: ``{key: {description, default, created}}``."""
    return load_shared("feature_flags.json")["flags"]


def posthog_key(key: str) -> str:
    """The key under which ``key`` lives in the shared PostHog project."""
    return f"{config.posthog_flag_prefix}{key}"


def _get_client():
    """Posthog client with local evaluation, or None when unavailable."""
    global _client, _client_ready
    if _client_ready:
        return _client
    _client_ready = True
    if not config.posthog_api_key or not config.posthog_personal_api_key:
        return None
    try:
        from posthog import Posthog

        _client = Posthog(
            project_api_key=config.posthog_api_key,
            host=config.posthog_host,
            personal_api_key=config.posthog_personal_api_key,
            poll_interval=30,
        )
    except Exception:
        _client = None
    return _client


def is_enabled(key: str, distinct_id: str = "anonymous") -> bool:
    """Evaluate one switch for a requester (account id, or "anonymous")."""
    reg = registry()
    if key not in reg:
        # Unknown switch: fail closed so a typo can't silently expose a feature.
        return False
    overrides = _overrides()
    if key in overrides:
        return overrides[key]
    if not config.posthog_api_key:
        # Self-host: full product, no PostHog dependency. Inverse-polarity
        # switches (e.g. site-building, where ON hides the product) opt out via
        # an explicit `self_host` value in the registry.
        return bool(reg[key].get("self_host", True))
    default = bool(reg[key]["default"])
    client = _get_client()
    if client is None:
        return default
    try:
        result = client.feature_enabled(
            posthog_key(key),
            distinct_id,
            only_evaluate_locally=True,
            send_feature_flag_events=False,
        )
    except Exception:
        return default
    return default if result is None else bool(result)


def resolve_all(distinct_id: str = "anonymous") -> dict[str, bool]:
    """Every registered switch resolved for a requester (for /auth/me and /features)."""
    return {key: is_enabled(key, distinct_id) for key in registry()}
