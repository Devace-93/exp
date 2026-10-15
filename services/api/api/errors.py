"""A single error type that every blueprint raises.

The app-level error handler (see ``api.app``) turns an :class:`ApiError` into the
JSON envelope the whole monorepo agrees on::

    {"error": {"code": "...", "message": "...", ...extra}}

Keeping this in its own tiny module avoids a circular import between ``app`` and
the auth decorators (both need to raise it).
"""
from __future__ import annotations


class ApiError(Exception):
    """An error meant to be surfaced to the API client as JSON.

    Parameters
    ----------
    status:
        HTTP status code to respond with (e.g. 401, 402, 404).
    code:
        Stable, machine-readable error code (e.g. ``"limit_reached"``).
    message:
        Human-readable description.
    extra:
        Optional extra keys merged into the ``error`` object. For the
        limit-reached case the contract expects a ``which`` key, so we pass
        ``extra={"which": "flags"}``.
    """

    def __init__(self, status: int, code: str, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}

    def to_dict(self) -> dict:
        error: dict = {"code": self.code, "message": self.message}
        error.update(self.extra)
        return {"error": error}
