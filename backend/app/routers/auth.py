import hmac
import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import MembershipEvent, MemberStatus, Person, User, UserRole
from app.ratelimit import enforce, login_limiter
from app.schemas.auth import (
    LoginRequest,
    MeOut,
    PasswordChange,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.security import (
    check_login_password,
    clear_session_cookie,
    cookie_secure,
    create_access_token,
    get_current_user,
    hash_password,
    membership_block_reason,
    require_admin,
    set_session_cookie,
)
from app.services import orcid as orcid_svc

router = APIRouter(prefix="/auth", tags=["auth"])

STATE_MAX_AGE = 600  # seconds
# Ties the signed OAuth state to the browser that started the sign-in; the
# callback rejects any state minted for a different session (login CSRF).
STATE_COOKIE = "usmccdb_oauth_state"


def _state_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt="orcid-state")


def _redirect_uri(request: Request) -> str:
    settings = get_settings()
    if settings.site_url:
        base = settings.site_url.rstrip("/")
    else:
        base = str(request.base_url).rstrip("/")
    return f"{base}/api/v1/auth/orcid/callback"


@router.post("/login")
def login(
    body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> UserOut:
    enforce(login_limiter(), request)
    user = db.execute(
        select(User).where(User.username == body.username)
    ).scalar_one_or_none()
    # One generic answer for unknown username, wrong password, and disabled
    # account alike — the response must not confirm that an account exists
    # (issue #62). check_login_password burns a bcrypt verification even for
    # unknown usernames so timing gives the same nothing away.
    if not check_login_password(user, body.password) or not user.is_active:
        raise HTTPException(401, "Invalid username or password")
    reason = membership_block_reason(db, user)
    if reason:
        raise HTTPException(403, reason)
    user.last_login_at = datetime.now(UTC)
    db.commit()
    set_session_cookie(response, request, create_access_token(user))
    return UserOut.model_validate(user)


@router.post("/logout")
def logout(response: Response) -> dict:
    clear_session_cookie(response)
    return {"detail": "Signed out"}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeOut:
    settings = get_settings()
    person = db.get(Person, user.person_id) if user.person_id else None
    permissions = ["member"]
    if user.role == UserRole.admin:
        permissions = ["admin", "office", "member"]
    elif user.role == UserRole.office:
        permissions = ["office", "member"]
    return MeOut(
        user=UserOut.model_validate(user),
        person_id=user.person_id,
        display_name=person.display_name if person else user.username,
        permissions=permissions,
        orcid_enabled=settings.orcid_enabled,
        contact_email=settings.contact_email,
    )


@router.post("/me/password")
def change_my_password(
    body: PasswordChange,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Self-service password change for local accounts (issue #98)."""
    if not user.username or not user.password_hash:
        raise HTTPException(400, "This account signs in with ORCID and has no password")
    if not check_login_password(user, body.current_password):
        raise HTTPException(403, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"detail": "Password changed"}


@router.get("/config")
def auth_config() -> dict:
    """Unauthenticated: what login methods are available."""
    settings = get_settings()
    return {
        "orcid_enabled": settings.orcid_enabled,
        "contact_email": settings.contact_email,
    }


# --- Local account management (admin) ---------------------------------------


@router.get("/users", dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)) -> list[UserOut]:
    users = db.execute(select(User).order_by(User.id)).scalars().all()
    return [UserOut.model_validate(u) for u in users]


@router.post("/users", dependencies=[Depends(require_admin)], status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db)) -> UserOut:
    exists = db.execute(select(User).where(User.username == body.username)).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Username already taken")
    if body.person_id is not None and db.get(Person, body.person_id) is None:
        raise HTTPException(404, "person_id not found")
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
        person_id=body.person_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    if body.role is not None:
        if user.id == actor.id and body.role != UserRole.admin:
            raise HTTPException(400, "You cannot demote your own account")
        user.role = body.role
    if body.is_active is not None:
        if user.id == actor.id and not body.is_active:
            raise HTTPException(400, "You cannot deactivate your own account")
        user.is_active = body.is_active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if body.person_id is not None:
        if db.get(Person, body.person_id) is None:
            raise HTTPException(404, "person_id not found")
        user.person_id = body.person_id
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


_ROLE_RANK = {UserRole.member: 0, UserRole.office: 1, UserRole.admin: 2}


@router.post("/users/{keep_id}/merge/{other_id}")
def merge_users(
    keep_id: int,
    other_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
) -> UserOut:
    """Merge two accounts belonging to the same human — typically a local
    username account and an ORCID account (issue #97). The kept account
    absorbs the other's credentials (username/password, ORCID iD), person
    link, and the more privileged role; the other account is deleted."""
    if keep_id == other_id:
        raise HTTPException(400, "Pick two different accounts")
    if other_id == actor.id:
        raise HTTPException(400, "You cannot merge away the account you are signed in with")
    keep = db.get(User, keep_id)
    other = db.get(User, other_id)
    if keep is None or other is None:
        raise HTTPException(404, "User not found")
    if keep.username and other.username:
        raise HTTPException(409, "Both accounts have usernames — these are two local accounts")
    if keep.orcid and other.orcid:
        raise HTTPException(409, "Both accounts have ORCID iDs — these are two ORCID accounts")
    if keep.person_id and other.person_id and keep.person_id != other.person_id:
        raise HTTPException(
            409, "Accounts are linked to different people — fix the person links first"
        )
    username = keep.username or other.username
    password_hash = keep.password_hash or other.password_hash
    orcid = keep.orcid or other.orcid
    person_id = keep.person_id or other.person_id
    role = keep.role if _ROLE_RANK[keep.role] >= _ROLE_RANK[other.role] else other.role
    db.delete(other)
    db.flush()  # release the unique username/orcid/person_id before reassigning
    keep.username = username
    keep.password_hash = password_hash
    keep.orcid = orcid
    keep.person_id = person_id
    keep.role = role
    db.commit()
    db.refresh(keep)
    return UserOut.model_validate(keep)


# --- ORCID OAuth --------------------------------------------------------------


@router.get("/orcid/login")
def orcid_login(request: Request) -> RedirectResponse:
    settings = get_settings()
    if not settings.orcid_enabled:
        raise HTTPException(404, "ORCID sign-in is not configured")
    nonce = secrets.token_urlsafe(32)
    state = _state_serializer().dumps({"nonce": nonce})
    response = RedirectResponse(orcid_svc.authorize_url(_redirect_uri(request), state))
    response.set_cookie(
        STATE_COOKIE,
        nonce,
        max_age=STATE_MAX_AGE,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
        path="/",
    )
    return response


@router.get("/orcid/callback")
async def orcid_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    settings = get_settings()
    if not settings.orcid_enabled:
        raise HTTPException(404, "ORCID sign-in is not configured")

    def bounce(dest: str) -> RedirectResponse:
        # The state cookie is single-use — drop it whichever way this ends.
        r = RedirectResponse(dest)
        r.delete_cookie(STATE_COOKIE, path="/")
        return r

    if error or not code or not state:
        return bounce("/login?error=orcid_denied")
    try:
        payload = _state_serializer().loads(state, max_age=STATE_MAX_AGE)
    except BadSignature:
        return bounce("/login?error=orcid_state")
    # The state must have been minted for THIS browser: its nonce has to
    # match the cookie set when the sign-in started. Otherwise an attacker
    # could hand their own callback URL to a victim and silently sign the
    # victim into the attacker's account (login CSRF, issue #62).
    nonce = payload.get("nonce") or ""
    cookie_nonce = request.cookies.get(STATE_COOKIE) or ""
    if not nonce or not hmac.compare_digest(nonce, cookie_nonce):
        return bounce("/login?error=orcid_state")

    token = await orcid_svc.exchange_code(code, _redirect_uri(request))
    orcid_id: str = token["orcid"]
    name: str = token.get("name") or ""

    # 1. Existing login with this ORCID iD.
    user = db.execute(select(User).where(User.orcid == orcid_id)).scalar_one_or_none()

    if user is None:
        # 2. Directory member with this ORCID iD: link automatically. If the
        # person already signs in with a local account, attach the ORCID to
        # that account instead of creating a parallel login — the OAuth
        # round trip just proved ownership of the id (issue #97).
        person = db.execute(
            select(Person).where(Person.orcid == orcid_id)
        ).scalar_one_or_none()
        if person is not None:
            existing = db.execute(
                select(User).where(User.person_id == person.id)
            ).scalar_one_or_none()
            if existing is None:
                user = User(orcid=orcid_id, person_id=person.id, role=UserRole.member)
                db.add(user)
                db.commit()
                db.refresh(user)
            elif existing.orcid is None:
                existing.orcid = orcid_id
                user = existing
                db.commit()
            # else: the person's account already carries a *different* ORCID
            # iD — ambiguous records; fall through to the unknown-ORCID path
            # so the office sorts it out instead of guessing here.

    if user is None:
        # 3. Unknown ORCID: create a pending person + login, send to the
        # registration form. Someone with approval rights activates (or
        # rejects) later; until then the login gets no member-level access.
        given, family = "", ""
        if name:
            parts = name.rsplit(" ", 1)
            given, family = (parts[0], parts[1]) if len(parts) == 2 else ("", name)
        person = Person(
            given_name=given or "Unknown",
            family_name=family or orcid_id,
            email=f"{orcid_id}@orcid.placeholder",  # replaced when they complete the form
            orcid=orcid_id,
            status=MemberStatus.pending,
        )
        db.add(person)
        db.flush()
        db.add(MembershipEvent(person_id=person.id, from_status=None, to_status="pending"))
        user = User(orcid=orcid_id, person_id=person.id, role=UserRole.member)
        db.add(user)
        db.commit()
        db.refresh(user)

    if not user.is_active:
        return bounce("/login?error=account_disabled")

    person = db.get(Person, user.person_id) if user.person_id else None
    needs_registration = bool(
        person is not None and person.email.endswith("@orcid.placeholder")
    )

    # Unapproved memberships get no session — except an incomplete ORCID
    # registration, which keeps one solely so the registration form can
    # complete its own placeholder record (everything else is gated by
    # membership_block_reason in get_current_user).
    if person is not None and user.role == UserRole.member and not needs_registration:
        if person.status == MemberStatus.pending:
            return bounce("/login?error=membership_pending")
        if person.status == MemberStatus.rejected:
            return bounce("/login?error=membership_rejected")

    user.last_login_at = datetime.now(UTC)
    db.commit()

    dest = "/register?welcome=orcid" if needs_registration else "/"
    response = bounce(dest)
    set_session_cookie(response, request, create_access_token(user))
    return response
