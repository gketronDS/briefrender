import os
import signal
import time

POLL_INTERVAL_SECONDS = 5.0

_shutdown = False


def _request_shutdown(signum, frame):
    global _shutdown
    _shutdown = True


def main():
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    database_url = os.getenv("DATABASE_URL", "")
    db_state = "set" if database_url else "unset"
    print(f"briefrender worker starting (redis={redis_url}, db={db_state})", flush=True)

    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)

    while not _shutdown:
        # TODO: pull the next job off the queue and run decompose -> annotate -> plan -> render.
        time.sleep(POLL_INTERVAL_SECONDS)

    print("briefrender worker stopped", flush=True)


if __name__ == "__main__":
    main()
