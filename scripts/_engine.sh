# Sourced by the scripts/ entry points (never run directly) to pick the
# container engine. Expects the caller to have cd'd to the repo root.
#
# Configured via CONTAINER_ENGINE in .env or the environment (the environment
# wins): docker | podman | auto. auto (the default) uses docker when it is
# installed, otherwise podman.
#
# Defines:
#   ENGINE     docker or podman — for plain engine commands ($ENGINE volume …)
#   compose()  the matching compose command (docker compose / podman compose /
#              podman-compose)

_env_engine=$(grep -E '^CONTAINER_ENGINE=' .env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)
CONTAINER_ENGINE=${CONTAINER_ENGINE:-${_env_engine:-auto}}
unset _env_engine

case "$CONTAINER_ENGINE" in
    auto)
        if command -v docker >/dev/null 2>&1; then
            ENGINE=docker
        elif command -v podman >/dev/null 2>&1; then
            ENGINE=podman
        else
            echo "ERROR: neither 'docker' nor 'podman' found in PATH." >&2
            echo "Install one, or set CONTAINER_ENGINE in .env if it lives elsewhere." >&2
            exit 1
        fi
        ;;
    docker|podman)
        ENGINE=$CONTAINER_ENGINE
        if ! command -v "$ENGINE" >/dev/null 2>&1; then
            echo "ERROR: CONTAINER_ENGINE=$ENGINE (from .env or the environment)," >&2
            echo "but '$ENGINE' is not in PATH." >&2
            exit 1
        fi
        ;;
    *)
        echo "ERROR: CONTAINER_ENGINE must be 'docker', 'podman', or 'auto' (got '$CONTAINER_ENGINE')." >&2
        exit 1
        ;;
esac

if [ "$ENGINE" = podman ]; then
    # "podman compose" (podman >= 4.1) delegates to an external provider
    # (podman-compose or docker-compose); when that wrapper can't find one,
    # fall back to calling podman-compose directly.
    if podman compose version >/dev/null 2>&1; then
        compose() { podman compose "$@"; }
    elif command -v podman-compose >/dev/null 2>&1; then
        compose() { podman-compose "$@"; }
    else
        echo "ERROR: podman is installed but no compose provider is." >&2
        echo "Install podman-compose (or docker-compose) so 'podman compose' works." >&2
        exit 1
    fi
else
    compose() { docker compose "$@"; }
fi
