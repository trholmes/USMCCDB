from datetime import datetime

from pydantic import BaseModel, Field

from app.models import UserRole
from app.schemas.common import ORMModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(ORMModel):
    id: int
    person_id: int | None
    username: str | None
    orcid: str | None
    role: UserRole
    is_active: bool
    last_login_at: datetime | None


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.member
    person_id: int | None = None


class UserUpdate(BaseModel):
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    person_id: int | None = None
    # With person_id: also delete the person currently linked to the login,
    # provided it is an unapproved (pending/rejected) registration — the
    # duplicate an ORCID sign-in provisions when the directory record it
    # belongs to carried a different (mistyped) iD.
    replace_person: bool = False


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class MeOut(BaseModel):
    user: UserOut
    person_id: int | None
    display_name: str | None
    permissions: list[str]
    orcid_enabled: bool
    # Whether the server delivers mail (SMTP configured) — the UI warns before
    # actions that send notifications only when it does.
    email_enabled: bool
    contact_email: str
