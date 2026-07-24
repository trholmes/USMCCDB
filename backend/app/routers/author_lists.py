from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AuthorList, Publication, User
from app.schemas.publications import AuthorListOut, AuthorListRequest
from app.security import get_current_user, is_office
from app.services.author_list import build_snapshot
from app.services.exports import CONTENT_TYPES, RENDERERS

router = APIRouter(tags=["author-lists"])


def _can_generate(db, user: User, pub: Publication | None) -> bool:
    if is_office(user):
        return True
    if pub is None or user.person_id is None:
        return False
    from app.models import PublicationPerson, PublicationPersonRole

    row = db.execute(
        select(PublicationPerson.id).where(
            PublicationPerson.publication_id == pub.id,
            PublicationPerson.person_id == user.person_id,
            PublicationPerson.role == PublicationPersonRole.editor,
        )
    ).first()
    return row is not None


@router.post("/publications/{pub_id}/author-list", status_code=201)
def generate_for_publication(
    pub_id: int,
    body: AuthorListRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AuthorListOut:
    pub = db.get(Publication, pub_id)
    if pub is None:
        raise HTTPException(404, "Publication not found")
    if not _can_generate(db, user, pub):
        raise HTTPException(403, "Only editors or the office can generate author lists")
    cutoff = body.cutoff_date if body else pub.author_cutoff_date
    if cutoff is None:
        raise HTTPException(422, "No cutoff date: set author_cutoff_date or pass one")
    person_ids = None
    if body is not None and body.scope == "involved":
        from app.models import PublicationPerson, PublicationPersonRole

        person_ids = sorted(
            {
                pp.person_id
                for pp in db.execute(
                    select(PublicationPerson).where(
                        PublicationPerson.publication_id == pub.id,
                        PublicationPerson.role != PublicationPersonRole.reviewer,
                    )
                ).scalars()
            }
        )
        if not person_ids:
            raise HTTPException(422, "No people attached to this publication yet")
    snapshot = build_snapshot(db, cutoff, person_ids=person_ids)
    if not snapshot["authors"]:
        raise HTTPException(422, "No eligible authors on that date")
    alist = AuthorList(
        publication_id=pub_id,
        cutoff_date=cutoff,
        generated_by_user_id=user.id,
        snapshot=snapshot,
    )
    pub.author_cutoff_date = cutoff
    db.add(alist)
    db.commit()
    db.refresh(alist)
    return AuthorListOut.model_validate(alist)


@router.post("/author-lists/preview")
def preview(
    body: AuthorListRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Dry-run: build (but do not store) the list for an arbitrary date."""
    if not is_office(user):
        raise HTTPException(403, "Office only")
    return build_snapshot(db, body.cutoff_date)


@router.get("/author-lists")
def list_author_lists(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    publication_id: int | None = None,
) -> list[AuthorListOut]:
    stmt = select(AuthorList).order_by(AuthorList.created_at.desc())
    if publication_id is not None:
        stmt = stmt.where(AuthorList.publication_id == publication_id)
    lists = db.execute(stmt).scalars().all()
    return [AuthorListOut.model_validate(a) for a in lists]


@router.get("/author-lists/{list_id}")
def get_author_list(
    list_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)
) -> AuthorListOut:
    alist = db.get(AuthorList, list_id)
    if alist is None:
        raise HTTPException(404, "Author list not found")
    return AuthorListOut.model_validate(alist)


@router.get("/author-lists/{list_id}/export")
def export_author_list(
    list_id: int,
    format: str = "txt",
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Response:
    alist = db.get(AuthorList, list_id)
    if alist is None:
        raise HTTPException(404, "Author list not found")
    if format not in RENDERERS:
        raise HTTPException(422, f"format must be one of {sorted(RENDERERS)}")
    content = RENDERERS[format](alist.snapshot)
    ext = {"txt": "txt", "tex": "tex", "xml": "xml"}[format]
    filename = f"usmcc-authors-{alist.cutoff_date.isoformat()}.{ext}"
    return Response(
        content=content,
        media_type=CONTENT_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
