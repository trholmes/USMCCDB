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

    photos_dir: str = "/photos"

    orcid_client_id: str = ""
    orcid_client_secret: str = ""
    orcid_host: str = "orcid.org"

    @property
    def orcid_enabled(self) -> bool:
        return bool(self.orcid_client_id and self.orcid_client_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
