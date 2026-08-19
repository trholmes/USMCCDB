from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://usmccdb:usmccdb@localhost:5432/usmccdb"
    secret_key: str = "dev-only-change-me"

    site_url: str = ""
    site_domain: str = ""
    contact_email: str = ""

    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = ""

    access_token_hours: int = 12
    cookie_secure: str = "auto"  # auto | true | false

    # Per-IP limits on the unauthenticated endpoints (0 disables a limiter).
    login_rate_limit: int = 10
    login_rate_window_seconds: int = 60
    registration_rate_limit: int = 5
    registration_rate_window_seconds: int = 3600

    photos_dir: str = "/photos"

    # Backups volume shared with the backup container (see docker-compose.yml).
    # Manual backups are requested by dropping a file in <backups_dir>/requests;
    # the backup container's scheduler picks it up within a few seconds.
    backups_dir: str = "/backups"
    backup_hour: str = "02"  # informational, shown in the admin panel
    backup_trigger_timeout_seconds: int = 120

    orcid_client_id: str = ""
    orcid_client_secret: str = ""
    orcid_host: str = "orcid.org"

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_tls: str = "starttls"  # starttls | ssl | none
    email_from: str = ""  # falls back to CONTACT_EMAIL

    @property
    def orcid_enabled(self) -> bool:
        return bool(self.orcid_client_id and self.orcid_client_secret)

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_host)


@lru_cache
def get_settings() -> Settings:
    return Settings()
