"""Application factory.

``create_app()`` builds and returns the Flask app. Gunicorn runs it directly::

    gunicorn -b 0.0.0.0:5000 -w 2 'api.app:create_app()'

Responsibilities here: CORS, rate limiting, blueprint registration (billing is
conditional on ``BILLING_ENABLED``), health checks, and a small set of error
handlers that always emit the ``{"error": {...}}`` envelope.
"""
from __future__ import annotations

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException

from dbcore.config import config

from .errors import ApiError
from .extensions import limiter


def create_app() -> Flask:
    app = Flask(__name__)

    # ---- CORS: allow the dashboard (and apex) origins -----------------------
    # flask-cors is optional at import time so `py_compile`/tests don't hard-fail
    # if it isn't installed; in the real image it always is.
    try:
        from flask_cors import CORS

        CORS(
            app,
            resources={r"/api/*": {"origins": [config.dashboard_url, config.app_base_url]}},
            supports_credentials=True,
        )
    except ImportError:  # pragma: no cover
        pass

    # ---- Rate limiting (Redis-backed) --------------------------------------
    limiter.init_app(app)

    # ---- Blueprints, all mounted under /api --------------------------------
    from .blueprints.account import bp as account_bp
    from .blueprints.apikeys import bp as apikeys_bp
    from .blueprints.auth import bp as auth_bp
    from .blueprints.environments import bp as environments_bp
    from .blueprints.eval import bp as eval_bp
    from .blueprints.flags import bp as flags_bp
    from .blueprints.projects import bp as projects_bp
    from .features import bp as features_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(projects_bp, url_prefix="/api/projects")
    app.register_blueprint(environments_bp, url_prefix="/api/projects/<project_id>/environments")
    app.register_blueprint(flags_bp, url_prefix="/api/projects/<project_id>/flags")
    app.register_blueprint(eval_bp, url_prefix="/api/eval")
    app.register_blueprint(account_bp, url_prefix="/api/account")
    app.register_blueprint(apikeys_bp, url_prefix="/api/apikeys")
    app.register_blueprint(features_bp, url_prefix="/api/features")

    # Billing is omitted entirely for self-host builds (BILLING_ENABLED=false).
    if config.billing_enabled:
        from .blueprints.billing import bp as billing_bp

        app.register_blueprint(billing_bp, url_prefix="/api/billing")

    # ---- Health checks ------------------------------------------------------
    # Bare /healthz for the container/load-balancer; /api/healthz behind Caddy.
    @app.get("/healthz")
    @app.get("/api/healthz")
    @limiter.exempt
    def healthz():
        return jsonify({"status": "ok"})

    _register_error_handlers(app)
    return app


def _register_error_handlers(app: Flask) -> None:
    """Every error path returns the shared ``{"error": {...}}`` JSON shape."""

    @app.errorhandler(ApiError)
    def _handle_api_error(err: ApiError):
        return jsonify(err.to_dict()), err.status

    @app.errorhandler(429)
    def _handle_rate_limit(err):
        return (
            jsonify({"error": {"code": "rate_limited", "message": "Too many requests."}}),
            429,
        )

    @app.errorhandler(HTTPException)
    def _handle_http_exception(err: HTTPException):
        # Map any other werkzeug error (404, 405, 400, ...) into our envelope.
        code = (err.name or "error").lower().replace(" ", "_")
        return (
            jsonify({"error": {"code": code, "message": err.description or err.name}}),
            err.code or 500,
        )

    @app.errorhandler(Exception)
    def _handle_unexpected(err: Exception):  # pragma: no cover
        app.logger.exception("Unhandled exception")
        return (
            jsonify({"error": {"code": "internal_error", "message": "An unexpected error occurred."}}),
            500,
        )
