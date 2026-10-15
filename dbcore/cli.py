"""Tiny management CLI used by the `migrate` compose service.

    python -m dbcore.cli upgrade      # create_all + alembic upgrade head
    python -m dbcore.cli migrate      # alembic upgrade head only
    python -m dbcore.cli create-all   # SQLAlchemy create_all only

Schema lifecycle: ``create_all`` bootstraps a fresh database in one shot, then
Alembic (``db/migrations``) evolves it. Migrations are written idempotently so
the two can run back to back on both fresh and existing databases. With zero
migrations ``upgrade`` is just ``create_all`` plus an empty Alembic run.
"""
from __future__ import annotations

import sys
from pathlib import Path

from . import models  # noqa: F401  (register models on Base.metadata)
from .db import Base, engine


def create_all() -> None:
    Base.metadata.create_all(engine)
    print("✓ tables ensured")


def _db_dir() -> Path:
    """Locate db/ (alembic.ini + migrations) locally or inside the image."""
    for candidate in (Path(__file__).resolve().parents[1] / "db", Path("/app/db")):
        if (candidate / "alembic.ini").is_file():
            return candidate
    raise FileNotFoundError("db/alembic.ini not found")


def migrate() -> None:
    """``alembic upgrade head`` via the Python API (no CLI/cwd assumptions)."""
    from alembic import command
    from alembic.config import Config as AlembicConfig

    db_dir = _db_dir()
    cfg = AlembicConfig(str(db_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(db_dir / "migrations"))
    command.upgrade(cfg, "head")
    print("✓ migrations applied")


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "upgrade"
    if cmd == "upgrade":
        create_all()
        migrate()
    elif cmd == "migrate":
        migrate()
    elif cmd == "create-all":
        create_all()
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
