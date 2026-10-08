import logging

from app.configuration import get_runtime_configuration


logger = logging.getLogger(__name__)


def configure_error_monitoring():
    runtime = get_runtime_configuration()
    if not runtime.sentry_dsn:
        return
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=runtime.sentry_dsn,
            environment=runtime.app_env,
            traces_sample_rate=float(runtime.sentry_traces_sample_rate or 0),
            send_default_pii=False,
            include_local_variables=False,
            max_request_body_size="never",
        )
    except ModuleNotFoundError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed")
    except (TypeError, ValueError) as error:
        logger.warning("Sentry configuration is invalid: %s", error)
