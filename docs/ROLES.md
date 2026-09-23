# Roles and permissions

Who can do what in the collaboration database. Two separate things decide
this:

1. **Account roles** — the permission level of a *sign-in* (`users.role`),
   assigned explicitly by an admin. This is what the API checks.
2. **Collaboration positions** — leadership and committee posts a *person*
   holds (`collab_roles`, with start/end dates). These are directory facts.
   Two of them carry scoped permissions of their own (working-group convener,
   Administrative Institutional Contact); none of them changes an account's
   role. The admin **Alerts** panel *suggests* a role change when an active
   position and the account's role disagree, and the admin decides
   (issue #167).

A third factor, the person's **membership status**, gates access altogether
for member-level accounts.

Code: `backend/app/models/auth.py` (`UserRole`, `ROLE_RANK`),
`backend/app/security.py` (`require_*`, `has_role`, `can_manage_*`,
`is_convener_of`, `is_admin_contact_for`, `membership_block_reason`),
`backend/app/routers/people.py` (`SELF_EDITABLE`, `ADMIN_CONTACT_EDITABLE`,
`SELF_SETTABLE_STATUSES`). The frontend mirrors the rules in
`frontend/src/constants.ts` and gates the UI from the `permissions` list that
`GET /auth/me` returns (every role at or below the account's own).

## Account roles

Ordered from most to least privileged. **Each role holds every permission of
the roles below it.**

| Role | Meant for | Adds on top of the role below |
|---|---|---|
| `admin` | The people running the database. | User accounts (create, link to a person, merge, reset passwords, change roles, deactivate, delete), site settings (banner, login message, map key), the Alerts panel, the Email log and test email, backups and restore, system status, deleting working groups. Cannot demote or deactivate their own account. |
| `office` | The collaboration office: membership administration. | Approve/reject registrations and change anyone's status; edit any profile field (including ORCID iD and office-internal notes); create/edit/delete institutions; manage every affiliation and author period; assign and end every collaboration position; register people directly (gets a real response instead of the neutral acknowledgement, and no rate limit); see membership-event notes and actors. |
| `leadership` | Leadership Council representatives and deputies. | Create and edit working groups, add or remove anyone from them, name and end **conveners** (no other position); edit any publication, its status, people and reviewers, build and preview author lists (`can_manage_publications`). |
| `speakers_committee` | The speakers committee. | Create/edit/delete events; edit or delete **any** talk; act on any nomination (shortlist, assign, decline) (`can_manage_talks`). |
| `member` | Everyone else with a sign-in. | See the directory, institutions, working groups, leadership, events, talks, publications and statistics; the self-service actions below. |

### What every member can do

- **Own profile**: edit the `SELF_EDITABLE` fields — preferred name, email,
  career stage, professional title, department, research time on µC,
  research areas, expertise, voting flag, grant numbers, acknowledgement
  text — and upload/remove their photo. **Not** their ORCID iD (set only by
  an authenticated ORCID sign-in or the office, because the sign-in auto-link
  trusts it), names, or notes.
- **Own status**: set it to `active`, `inactive` or `alumni`, both from and
  to; never into or out of `pending`/`rejected`, which the office decides.
- **Own affiliations**: record a move to a new primary institution and add
  secondary affiliations (the office edits history).
- **Working groups**: join and leave themselves.
- **Talks**: add talks (seminars, colloquia, conference talks) and edit or
  delete the ones they added; nominate anyone for a talk; withdraw a
  nomination of themselves or one they made.
- **Publications**: register a publication (becoming one of its contacts);
  describe their own contribution to any paper they are attached to.
- **Voting**: the voting flag is validated server-side for everyone: an
  active, non-student member currently at a US institution. Anything else is
  refused (or, on activation, silently dropped).

### Contextual permissions (any role)

Some permissions come from a relationship to the record rather than the role:

| Context | Permission |
|---|---|
| **Publication contact** (attached with the `contact` role; the creator automatically) | Edit the paper, attach and remove people (except reviewers), request collaboration review and withdraw that request, generate the paper's author list. |
| **Working-group convener** (active `convener` position for that group) | Add and remove members of the group. For publications tagged with the group: the same as a contact. |
| **Administrative Institutional Contact** (active `admin_contact` position for that institution) | Edit the `ADMIN_CONTACT_EDITABLE` fields — career stage, professional title, department, research time — of people currently at the institution, and approve or reject **pending** registrations of people at the institution. Nothing else. |
| **Talk creator** | Edit or delete the talk. |

## Membership status and access

`people.status` is `pending`, `active`, `inactive`, `alumni` or `rejected`.
Changes are recorded append-only in `membership_events` (from, to, effective
date, actor, note); notes and actors are office-internal.

- A **`member`-role account whose person is `pending` or `rejected` has no
  API access at all** (`membership_block_reason`): self-registration — by
  form or ORCID — must not grant access before approval. The one exception is
  completing the registration form after an ORCID sign-in.
- Accounts with any higher role are exempt: their access comes from the role,
  and someone has to be able to approve.
- Voting membership cannot be held while not `active`.
- Deactivated accounts (`is_active = false`) cannot sign in regardless of
  role or status.

## Collaboration positions

Positions (`collab_roles`) describe the organigram and drive the Leadership
page, the alerts panel's role suggestions, and several email audiences (see
`docs/NOTIFICATIONS.md`). They are dated; "active" means today falls within
start and end.

| Position | Qualifier (`detail`) | Scope | Grants |
|---|---|---|---|
| `chair`, `vice_chair` | — | — | Nothing by itself; leadership audience for email; suggests the `leadership` account role. |
| `representative`, `deputy_representative` | **Required**, one of Accelerator / Experimental / Theory / Communications (issue #159). | — | As above. |
| `coordinator`, `deputy_coordinator` | Required, free text | — | Nothing. Kept for existing rows; not offered in the UI. |
| `area_lead` | Required, free text (Target, RF, …) | — | Nothing. Not offered in the UI. |
| `lsg_member` | — | — | Nothing (Leadership Strategy Group). |
| `ib_rep` | — | institution | Nothing. Not offered in the UI. |
| `admin_contact` | — | institution (required) | The Administrative Institutional Contact permissions above; audience for registration mail from that institution. Assigned from the institution page. |
| `convener` | — | working group (required) | The convener permissions above; suggests nothing. |
| `speakers_comm` | — | — | Nothing by itself; speakers-committee audience for email; suggests the `speakers_committee` account role. |
| `pub_chair`, `secretary` | — | — | Nothing. Not offered in the UI. |
| `other` | Required: the full title | — | Nothing. |

**Who may assign positions**: the office assigns and ends every position;
`leadership` accounts may name and end conveners only. Positions never
change an account's role: the alerts panel suggests promoting an account
whose person holds an active chair, vice chair, representative, deputy or
speakers-committee position, and demoting a `leadership` /
`speakers_committee` account with no such position (or an ex-chair still
holding `admin`/`office`); dismissed suggestions stay quiet until the
positions change.

## Anonymous (no sign-in)

- Read the public site settings (banner, login message) and the auth config.
- Submit the registration form (rate limited; always gets the same neutral
  acknowledgement).
- Read the public institution list (for the registration form) and the public
  publication list.
- Start an ORCID sign-in.

## Where to look when changing a rule

- Add or reorder a role: `UserRole` + `ROLE_RANK` in `models/auth.py`, the
  `require_*` dependencies in `security.py`, `USER_ROLES` in
  `frontend/src/constants.ts`, the `Role` type in `frontend/src/api/types.ts`,
  a migration (`ALTER TYPE user_role ADD VALUE`), and this file.
- Let members edit another profile field: `SELF_EDITABLE` (and, if admin
  contacts should too, `ADMIN_CONTACT_EDITABLE`) in `routers/people.py`, the
  matching form in `frontend/src/pages/Person.tsx`, and this file.
- Give a position a permission: add an `is_<position>_for`-style helper in
  `security.py` next to `is_convener_of`, check it in the router, and
  document it here and in `CLAUDE.md`.
