# Database

The canonical schema is defined in [`../dbcore/models.py`](../dbcore/models.py)
(SQLAlchemy). Plan limits and API-key roles come from
[`../packages/shared`](../packages/shared).

## First build
Tables are created by the `migrate` compose service:

```bash
python -m dbcore.cli upgrade   # create_all (idempotent) + alembic upgrade head
```

`migrations/versions/` starts empty: `create_all` bootstraps a fresh database
and Alembic is only there to evolve the schema once it is live.

## Future migrations (Alembic)
Once the schema is live and you start changing it, switch to versioned migrations:

```bash
cd db
DATABASE_URL=postgresql+psycopg://exp:exp@localhost:5432/exp \
  alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

`env.py` imports `dbcore.models` so autogenerate sees every table, and reads the
DB URL from `DATABASE_URL`. Write migrations idempotently (check the live schema
first): fresh installs get every table from `create_all` before they run.
