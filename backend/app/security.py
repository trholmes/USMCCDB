from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Affiliation, CollabRole, CollabRoleType, MemberStatus, Person, User, UserRole

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

COOKIE_NAME = "usmccdb_session"
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user: User) -> str:
    settings = get_settings()
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "person_id": user.person_id,
        "exp": datetime.now(UTC) + timedelta(hours=settings.access_token_hours),
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    settings = get_settings()
    if settings.cookie_secure == "true":
        secure = True
    elif settings.cookie_secure == "false":
        secure = False
    else:  # auto: honor X-Forwarded-Proto set by caddy/nginx
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        secure = proto == "https"
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.access_token_hours * 3600,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")


def membership_block_reason(db: Session, user: User) -> str | None:
    """Why a signed-in account gets no API access, or None if it does.

    A member-role account whose linked person is in a moderation state
    (pending/rejected) has not been approved — self-registration (ORCID or
    the form) must not grant member-level access to the database. Office and
    admin accounts are exempt: their access comes from the role, which only
    an admin can assign, and someone has to be able to approve."""
    if user.role != UserRole.member or user.person_id is None:
        return None
    person = db.get(Person, user.person_id)
    if person is None:
        return None
    if person.status == MemberStatus.pending:
        return "Your membership registration is awaiting approval"
    if person.status == MemberStatus.rejected:
        return "Your membership registration was not approved"
    return None


def _session_user(request: Request, db: Session) -> User | None:
    """Cookie → active User, or None. No membership-status gate."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        payload = _decode_token(token)
    except HTTPException:
        return None
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        return None
    return user


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    payload = _decode_token(token)
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled or missing")
    reason = membership_block_reason(db, user)
    if reason:
        raise HTTPException(status.HTTP_403_FORBIDDEN, reason)
    return user


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    user = _session_user(request, db)
    if user is None or membership_block_reason(db, user):
        return None
    return user


def get_applicant_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    """Signed-in user WITHOUT the moderation-state gate. Only for the public
    registration endpoint: a pending ORCID sign-in must be able to complete
    its own placeholder person record — and nothing else."""
    return _session_user(request, db)


def require_role(*roles: UserRole):
    """Dependency factory: allow only the given roles (admin always allowed)."""

    allowed = set(roles) | {UserRole.admin}

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    return checker


require_admin = require_role()  # admin only
require_office = require_role(UserRole.office)  # office or admin


def is_office(user: User) -> bool:
    return user.role in (UserRole.admin, UserRole.office)


def is_convener_of(db: Session, user: User, working_group_id: int | None) -> bool:
    """True if the user's person holds an active convener role for the WG."""
    if user.person_id is None or working_group_id is None:
        return False
    today = datetime.now(UTC).date()
    row = db.execute(
        select(CollabRole.id).where(
            CollabRole.person_id == user.person_id,
            CollabRole.role == CollabRoleType.convener,
            CollabRole.working_group_id == working_group_id,
            CollabRole.start_date <= today,
            (CollabRole.end_date.is_(None)) | (CollabRole.end_date >= today),
        )
    ).first()
    return row is not None


def is_admin_contact_for(db: Session, user: User, person_id: int) -> bool:
    """True if the user's person holds an active Administrative Institutional
    Contact role at the institution of person_id's current (open) primary
    affiliation. Admin contacts keep the institutional info of the members at
    their institution up to date (charter)."""
    if user.person_id is None:
        return False
    today = datetime.now(UTC).date()
    row = db.execute(
        select(CollabRole.id)
        .join(Affiliation, Affiliation.institution_id == CollabRole.institution_id)
        .where(
            CollabRole.person_id == user.person_id,
            CollabRole.role == CollabRoleType.admin_contact,
            CollabRole.start_date <= today,
            (CollabRole.end_date.is_(None)) | (CollabRole.end_date >= today),
            Affiliation.person_id == person_id,
            Affiliation.is_primary.is_(True),
            Affiliation.end_date.is_(None),
        )
    ).first()
    return row is not None
