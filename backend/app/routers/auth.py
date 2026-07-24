from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import MemberStatus, Person, User, UserRole
from app.schemas.auth import LoginRequest, MeOut, UserCreate, UserOut, UserUpdate
from app.security import (
    clear_session_cookie,
    create_access_token,
    get_current_user,
    hash_password,
    is_office,
    require_admin,
    set_session_cookie,
    verify_password,
)
from app.services import orcid as orcid_svc

router = APIRouter(prefix="/auth", tags=["auth"])

STATE_MAX_AGE = 600  # seconds


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
    user = db.execute(
        select(User).where(User.username == body.username)
    ).scalar_one_or_none()
    if user is None or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")
    if not user.is_active:
        raise HTTPException(403, "Account is disabled")
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


# --- ORCID OAuth --------------------------------------------------------------


@router.get("/orcid/login")
def orcid_login(request: Request) -> RedirectResponse:
    settings = get_settings()
    if not settings.orcid_enabled:
        raise HTTPException(404, "ORCID sign-in is not configured")
    state = _state_serializer().dumps({"next": "/"})
    return RedirectResponse(orcid_svc.authorize_url(_redirect_uri(request), state))


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
    if error or not code or not state:
        return RedirectResponse("/login?error=orcid_denied")
    try:
        _state_serializer().loads(state, max_age=STATE_MAX_AGE)
    except BadSignature:
        return RedirectResponse("/login?error=orcid_state")

    token = await orcid_svc.exchange_code(code, _redirect_uri(request))
    orcid_id: str = token["orcid"]
    name: str = token.get("name") or ""

    # 1. Existing login with this ORCID iD.
    user = db.execute(select(User).where(User.orcid == orcid_id)).scalar_one_or_none()

    if user is None:
        # 2. Imported/approved member without a login yet: link automatically.
        person = db.execute(
            select(Person).where(Person.orcid == orcid_id)
        ).scalar_one_or_none()
        if person is not None:
            user = User(orcid=orcid_id, person_id=person.id, role=UserRole.member)
            db.add(user)
            db.commit()
            db.refresh(user)

    if user is None:
        # 3. Unknown ORCID: create a pending person + login, send to the
        # registration form. Office approves (or rejects) later.
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
        user = User(orcid=orcid_id, person_id=person.id, role=UserRole.member)
        db.add(user)
        db.commit()
        db.refresh(user)

    if not user.is_active:
        return RedirectResponse("/login?error=account_disabled")

    user.last_login_at = datetime.now(UTC)
    db.commit()

    person = db.get(Person, user.person_id) if user.person_id else None
    needs_registration = bool(
        person is not None and person.email.endswith("@orcid.placeholder")
    )
    dest = "/apply?welcome=orcid" if needs_registration else "/"
    response = RedirectResponse(dest)
    set_session_cookie(response, request, create_access_token(user))
    return response
