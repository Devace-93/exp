"""Key validation and slugification for projects, environments and flags.

Keys are what SDKs and humans type (``new-checkout``, ``production``), so the
rules are strict and stable; they come straight from CONTRACT.md:

* project / environment keys: ``^[a-z0-9][a-z0-9-]{0,62}$``
* flag keys:                  ``^[a-z0-9][a-z0-9_-]{0,98}$``

(The contract does not spell out an environment key pattern; environments
share the project rule, which is the stricter of the two.)
"""
from __future__ import annotations

import re
import unicodedata

PROJECT_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
ENVIRONMENT_KEY_RE = PROJECT_KEY_RE
FLAG_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,98}$")

# Flag keys that would shadow the static sub-routes of /projects/:id/flags/*
# (POST .../flags/copy, GET .../flags/evaluate). Creating one is 400 reserved_key.
RESERVED_FLAG_KEYS = frozenset({"copy", "evaluate"})


def is_valid_project_key(key: str) -> bool:
    return bool(PROJECT_KEY_RE.match(key or ""))


def is_valid_environment_key(key: str) -> bool:
    return bool(ENVIRONMENT_KEY_RE.match(key or ""))


def is_valid_flag_key(key: str) -> bool:
    """Pattern check only; see :func:`is_reserved_flag_key` for the route clash."""
    return bool(FLAG_KEY_RE.match(key or ""))


def is_reserved_flag_key(key: str) -> bool:
    return key in RESERVED_FLAG_KEYS


def slugify(name: str, max_len: int = 63) -> str:
    """``"Web App (EU)"`` -> ``"web-app-eu"``. Lowercase ASCII, dashes between
    words, trimmed to ``max_len``; empty input yields ``""`` (caller decides)."""
    text = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text[:max_len].rstrip("-")
