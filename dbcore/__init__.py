"""dbcore — shared core used by the api service (and the migrate job).

Holds the single source of truth for: configuration, SQLAlchemy models,
plan limits, RBAC roles, key/slug validation, flag evaluation semantics,
usage metering, the audit trail and the PostHog client. The API Docker image
copies this package in next to ``packages/shared``.
"""

__version__ = "0.1.0"
