"""exp Flask API service.

App-factory entrypoint lives in `api.app:create_app`. Gunicorn runs that
factory directly. The package is mounted at `/app/api` inside the Docker image,
next to `/app/dbcore` and `/app/packages/shared`.
"""

__version__ = "0.1.0"
