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


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class MeOut(BaseModel):
    user: UserOut
    person_id: int | None
    display_name: str | None
    permissions: list[str]
    orcid_enabled: bool
    contact_email: str
