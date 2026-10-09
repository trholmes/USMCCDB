import secrets
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Affiliation, CollabRole, CollabRoleType, MemberStatus, Person, User, UserRole
from app.models.auth import ROLE_RANK

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

COOKIE_NAME = "usmccdb_session"
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


@lru_cache
def _phantom_hash() -> str:
    """A throwaway bcrypt hash used to burn the same work on unknown
    usernames as on real ones (login timing must not reveal whether an
    account exists — issue #62). Never matches: verification runs against
    a random secret that is not the submitted password."""
    return pwd_context.hash(secrets.token_hex(16))


def check_login_password(user: User | None, password: str) -> bool:
    """Constant-work password check for login: unknown usernames and
    ORCID-only accounts (no local password) still pay for one bcrypt
    verification before being turned away."""
    if user is not None and user.password_hash:
        return verify_password(password, user.password_hash)
    verify_password(password, _phantom_hash())
    return False


# Token claim carrying the account an admin is viewing the site as. The
# session's `sub` stays the admin: every request re-checks that they still
# hold the admin role, and actions are attributed to them (actor_of).
VIEW_AS_CLAIM = "view_as"


def create_access_token(
    user: User, *, view_as: User | None = None, exp: datetime | None = None
) -> str:
    """Session token for `user`. With view_as, the token also carries the
    account the (admin) user is viewing the site as; `exp` keeps an existing
    session's expiry instead of starting a fresh one."""
    settings = get_settings()
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "person_id": user.person_id,
        "exp": exp or datetime.now(UTC) + timedelta(hours=settings.access_token_hours),
        "iat": datetime.now(UTC),
    }
    if view_as is not None:
        payload[VIEW_AS_CLAIM] = view_as.id
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def cookie_secure(request: Request) -> bool:
    settings = get_settings()
    if settings.cookie_secure == "true":
        return True
    if settings.cookie_secure == "false":
        return False
    # auto: honor X-Forwarded-Proto set by caddy/nginx
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto == "https"


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.access_token_hours * 3600,
        httponly=True,
        secure=cookie_secure(request),
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
    the form) must not grant member-level access to the database. The same
    goes for a member-role account with no person at all: member access
    comes from an approved membership, and there is none to point at (the
    admin removed a duplicate registration, or never linked the login).
    Accounts with any other role are exempt: their access comes from the
    role, which only an admin can assign, and someone has to be able to
    approve."""
    if user.role != UserRole.member:
        return None
    person = db.get(Person, user.person_id) if user.person_id is not None else None
    if person is None:
        return "This sign-in is not linked to a collaboration member — contact the office"
    if person.status == MemberStatus.pending:
        return "Your membership registration is awaiting approval"
    if person.status == MemberStatus.rejected:
        return "Your membership registration was not approved"
    return None


def view_as_block_reason(db: Session, actor: User, target: User) -> str | None:
    """Why `actor` may not view the site as `target` right now, or None."""
    if actor.role != UserRole.admin:
        return "Only admins can view the site as another account"
    if target.id == actor.id:
        return "You are already signed in as this account"
    if not target.is_active:
        return "That account is deactivated"
    reason = membership_block_reason(db, target)
    if reason:
        return f"That account has no access: {reason}"
    return None


def _apply_view_as(db: Session, user: User, payload: dict) -> User:
    """Resolve the view_as claim: the account the session acts as, with the
    signed-in admin remembered on it for attribution (see actor_of).

    Re-validated on every request. When viewing is no longer possible (the
    admin lost the role, the viewed account was deactivated, deleted or
    moved into a moderation state), the session silently reverts to the
    admin's own view — never to more access than the admin has themselves,
    and never to an unusable session."""
    user.view_as_actor = None
    target_id = payload.get(VIEW_AS_CLAIM)
    if target_id is None:
        return user
    target = db.get(User, int(target_id))
    if target is None or view_as_block_reason(db, user, target):
        return user
    target.view_as_actor = user
    return target


def actor_of(user: User) -> User:
    """The account to record as having performed an action: the admin behind
    a view-as session, otherwise the user itself. Use it wherever an action
    is attributed (membership events, talks added, nominations, email log,
    …) — permission checks keep using the user the request acts as."""
    return getattr(user, "view_as_actor", None) or user


def actor_id(user: User) -> int:
    return actor_of(user).id


def session_expiry(request: Request) -> datetime | None:
    """When the current session cookie expires — reissued tokens (view as,
    and back) keep it rather than starting a fresh session."""
    payload = _session_payload(request)
    exp = payload.get("exp") if payload else None
    return datetime.fromtimestamp(exp, UTC) if exp else None


def _session_payload(request: Request) -> dict | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        return _decode_token(token)
    except HTTPException:
        return None


def _session_user(request: Request, db: Session) -> User | None:
    """Cookie → active User the session acts as, or None. No
    membership-status gate."""
    payload = _session_payload(request)
    if payload is None:
        return None
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        return None
    return _apply_view_as(db, user, payload)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    payload = _decode_token(token)
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled or missing")
    user = _apply_view_as(db, user, payload)
    reason = membership_block_reason(db, user)
    if reason:
        raise HTTPException(status.HTTP_403_FORBIDDEN, reason)
    return user


def get_signed_in_user(request: Request, db: Session = Depends(get_db)) -> User:
    """The account that actually signed in, ignoring any view-as claim —
    only for starting and stopping a view-as session, which must work
    whatever the viewed account may do."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    payload = _decode_token(token)
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled or missing")
    return user


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    user = _session_user(request, db)
    if user is None or membership_block_reason(db, user):
        return None
    return user


def get_registrant_user(request: Request, db: Session = Depends(get_db)) -> User | None:
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
# Leadership Council representatives / deputies (issue #167): working groups
# and their conveners, plus everything the speakers committee may do.
require_leadership = require_role(UserRole.office, UserRole.leadership)
# Speakers committee: full edit access to talks, events and nominations.
require_speakers_committee = require_role(
    UserRole.office, UserRole.leadership, UserRole.speakers_committee
)


def has_role(user: User, role: UserRole) -> bool:
    """True if the account holds `role` or a more privileged one."""
    return ROLE_RANK[user.role] >= ROLE_RANK[role]


def is_office(user: User) -> bool:
    return has_role(user, UserRole.office)


def can_manage_working_groups(user: User) -> bool:
    """Create/edit working groups, add or remove anyone, name conveners."""
    return has_role(user, UserRole.leadership)


def can_manage_publications(user: User) -> bool:
    """Edit any publication, its status, people and reviewers, and build
    author lists — not just publications one is a contact of."""
    return has_role(user, UserRole.leadership)


def can_manage_talks(user: User) -> bool:
    """Edit any talk, event or nomination — not just one's own."""
    return has_role(user, UserRole.speakers_committee)


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
