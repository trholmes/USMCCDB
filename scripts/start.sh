#!/usr/bin/env bash
# Start (or update + start) the USMCC database stack.
# First run: creates .env from .env.example with random secrets.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
    echo "No .env found — creating one from .env.example with random secrets."
    cp .env.example .env
    secret=$(openssl rand -hex 32)
    dbpass=$(openssl rand -hex 16)
    adminpass=$(openssl rand -hex 8)
    tmp=$(mktemp)
    sed -e "s|^SECRET_KEY=.*|SECRET_KEY=${secret}|" \
        -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${dbpass}|" \
        -e "s|^BOOTSTRAP_ADMIN_PASSWORD=.*|BOOTSTRAP_ADMIN_PASSWORD=${adminpass}|" \
        .env > "$tmp" && mv "$tmp" .env
    echo
    echo "  Generated SECRET_KEY and POSTGRES_PASSWORD."
    echo "  BOOTSTRAP ADMIN LOGIN:  username: admin   password: ${adminpass}"
    echo "  (Log in and change it, or create your own accounts and disable it.)"
    echo
    echo "  Recommended next edits to .env before going live:"
    echo "    SITE_DOMAIN=db.muoncollider.us     # enables the HTTPS (caddy) container"
    echo "    SITE_URL=https://db.muoncollider.us"
    echo "    CONTACT_EMAIL=you@example.edu"
    echo "    ORCID_CLIENT_ID / ORCID_CLIENT_SECRET   # enables ORCID sign-in"
    echo
fi

domain=$(grep -E '^SITE_DOMAIN=' .env | cut -d= -f2- | tr -d '[:space:]')
profile_args=()
if [ -n "${domain}" ]; then
    profile_args=(--profile tls)
fi

echo "Building and starting containers..."
docker compose ${profile_args[@]+"${profile_args[@]}"} up -d --build

echo
docker compose ${profile_args[@]+"${profile_args[@]}"} ps
port=$(grep -E '^HTTP_PORT=' .env | cut -d= -f2)
echo
if [ -n "${domain}" ]; then
    echo "Going live at https://${domain} (caddy is obtaining the TLS certificate;"
    echo "needs the domain's DNS pointing here and ports 80 + 443 open)."
    echo "Also reachable locally at http://localhost:${port:-8080}."
    echo
    echo "ORCID setup reminder: register a public-API client at"
    echo "  https://orcid.org/developer-tools"
    echo "with redirect URI: https://${domain}/api/v1/auth/orcid/callback"
else
    echo "Running at http://localhost:${port:-8080}."
    echo "To publish over HTTPS, set SITE_DOMAIN in .env and re-run this script."
fi
