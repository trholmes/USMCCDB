from pydantic import BaseModel


class PersonAlert(BaseModel):
    person_id: int
    name: str
    email: str | None = None
    # Human-readable context ("status is alumni", the institution, …).
    detail: str | None = None


class InstitutionAlert(BaseModel):
    institution_id: int
    name: str
    current_members: int


class AccountAlert(BaseModel):
    user_id: int
    login: str


class RoleSuggestionAlert(BaseModel):
    """An account whose role disagrees with the leadership positions its
    person currently holds (issue #167). Nothing is applied automatically —
    the admin decides."""

    user_id: int
    login: str
    person_id: int
    name: str
    current_role: str
    suggested_role: str
    # The positions behind the suggestion ("Accelerator Representative"), or
    # why a demotion is suggested ("no active leadership position").
    detail: str


class AdminAlerts(BaseModel):
    """Everything the admin alerts panel nags about; `total` feeds the badge
    in the navigation."""

    pending_registrations: list[PersonAlert]
    unreviewed_institutions: list[InstitutionAlert]
    institutions_missing_admin_contact: list[InstitutionAlert]
    unlinked_accounts: list[AccountAlert]
    role_suggestions: list[RoleSuggestionAlert]
    active_without_affiliation: list[PersonAlert]
    ineligible_voting_members: list[PersonAlert]
    open_author_periods_not_active: list[PersonAlert]
    migrations_pending: bool
    total: int
