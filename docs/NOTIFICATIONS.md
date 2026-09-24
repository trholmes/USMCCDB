# Email notifications

Every email the collaboration database sends, what triggers it, and who
receives it. The code is `backend/app/services/notifications.py` (one
function per kind) and `backend/app/services/email.py` (delivery and the
log); keep this file in step with them. Admins can see every send — with its
outcome — under **Admin → Email**.

## Configuration

| Setting | Purpose |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_TLS` | The outgoing mail server. **With `SMTP_HOST` empty, nothing is delivered**: every send is a logged no-op (status `disabled` in the log) and all workflows still work. |
| `EMAIL_FROM` | The From: address. Falls back to `CONTACT_EMAIL`. |
| `ADMIN_EMAIL` | Where mail for the people *running the database* goes — new registrations to review, duplicate and ORCID conflicts, review requests. Ideally a dedicated listserv for the database admins. Falls back to `CONTACT_EMAIL`. |
| `CONTACT_EMAIL` | The collaboration's public contact address: shown to members on the login page and in the footer of member-facing mail. Only receives notifications when `ADMIN_EMAIL` is unset. |
| `SITE_URL` | When set, messages carry links to the relevant page. |

Mail is composed inside the API request (it needs the database) and
delivered afterwards from a background task, so a slow or failing SMTP server
never delays or breaks the request that triggered it. Delivery failures are
logged, never raised.

## The UI asks before sending

Every action in the web UI that makes the server send one of the messages
below asks for confirmation first and names the recipients, so nobody mails a
member by accident (a status change, a convener term, a nomination, a review
request, …). The recipient wording lives in `frontend/src/emailWarnings.ts`
(`EMAIL_RECIPIENTS`) — update it alongside this catalogue. When the server has
no mail delivery configured (`SMTP_HOST` empty; `email_enabled` on `/auth/me`)
nothing is sent, so those actions run without the prompt. Automatic mail
(a registration submission, an ORCID conflict) is announced on the form
instead.

## Audiences

Recipients are built from these groups (helpers in `notifications.py`), combined
with set unions. Every message then drops blank and placeholder addresses
(ORCID sign-ins that have not completed the form) and — unless noted — the
person whose action triggered it, who already knows.

| Audience | Who that is |
|---|---|
| **admin list** | `ADMIN_EMAIL` (fallback `CONTACT_EMAIL`). |
| **office** | The admin list plus every active `admin` and `office` account that has a person (and so an address) linked. |
| **leadership** | Every active `leadership` account, plus everyone currently holding a Leadership Council position — chair, vice chair, representative, deputy representative — whether or not they have a sign-in. |
| **speakers committee** | Every active `speakers_committee` account, plus everyone currently holding a `speakers_comm` position. |
| **institution admin contacts** | Active Administrative Institutional Contacts of one institution. |
| **working group conveners** | Active conveners of one working group (available, not yet used by a message). |
| **publication contacts** | People attached to a paper with the `contact` role. |
| **the person** | The member the message is about, at the email on their record. |

Account-based audiences match the exact role: "leadership" means the
leadership people, not every admin who outranks them. Admins are reached
through **office**. Positions and account roles are both counted because a
person can hold a position without ever having signed in, and an account can
carry a role the admin granted without a position row.

## Catalogue

Kind is the key shown in the Admin → Email log and stored in `email_log.kind`.

### Membership

| Kind | Trigger | Recipients | Notes |
|---|---|---|---|
| `registration_submitted` | Someone submits the registration form or completes an ORCID sign-up. | office + admin contacts of the registrant's institution; never the registrant. | Carries name, email, ORCID iD, institution, position and a link. Says the registration stays pending with no access until approved. |
| `registration_duplicate` | A public registration matched an existing person record (by email), so nothing was created. | office | The submitter got the same neutral acknowledgement as everyone else (issue #62) and is **not** told about the match; the office follows up by hand. |
| `orcid_link_conflict` | An ORCID sign-in matched a directory record that could not be linked automatically (its login already carries a different iD, or holds a role above member). | office | A fresh pending registration was created for the sign-in; the office reconciles the two from Admin → Accounts (link the ORCID login to the existing record, or merge it into that record's login — the duplicate is deleted and the record takes the authenticated iD). |
| `registration_approved` | A pending person is set to **active** by the office or an institution admin contact. | the person | Welcome note with the site link and how to sign in: "use your account" if one is linked, "Sign in with ORCID" if ORCID is enabled, otherwise "the office will send your details". |
| `registration_rejected` | A pending person is set to **rejected**. | the person | Deliberately neutral; the office's note on the transition is internal and is **never** included. Gives `CONTACT_EMAIL`. |
| `membership_status_changed` | Any other status change made by someone other than the person (active → inactive, alumni, back to active, …). | the person | Names the old and new status and who made the change. A member's own status change tells nobody. |

### Working groups

| Kind | Trigger | Recipients | Notes |
|---|---|---|---|
| `convener_changed` | A convener position is added, removed, or its end date is set to today or earlier. | leadership + the person; minus the actor. | Subject starts "New / Removed / Ended convener for *WG*". Editing dates while the term stays open sends nothing; removing an already-ended term sends nothing. |

### Speakers bureau

| Kind | Trigger | Recipients | Notes |
|---|---|---|---|
| `nomination_submitted` | Someone nominates a person for a talk. | speakers committee; minus the nominator. | Includes the talk, event or venue, date and a link to the talks page. |
| `speaker_assigned` | A nomination is set to **assigned**, or a talk's speaker is set directly to a new person. | the speaker; minus the actor (a self-assignment sends nothing). | Re-saving the same speaker or clearing the speaker sends nothing. |

### Publications

| Kind | Trigger | Recipients | Notes |
|---|---|---|---|
| `publication_review_requested` | A paper moves to **collaboration review**. | admin list + leadership; minus the requester. | "Please assign reviewers." |
| `publication_reviewer_assigned` | A person is attached to a paper with the `reviewer` role (singly or in bulk). | the reviewer | |
| `publication_status_changed` | A paper's status changes (any transition). | publication contacts; minus the actor. | Sent alongside the review request when the transition is to collaboration review. |

### Admin

| Kind | Trigger | Recipients | Notes |
|---|---|---|---|
| `test` | "Send me a test email" on Admin → Email. | the admin's own address | Fails with 400 when the admin account has no person linked. Reports the SMTP settings in use. |

## Not (yet) sent

Things that happen without an email today, listed so the gaps are deliberate:

- A member joining or leaving a working group themselves, or being added by a convener.
- New talks, events or publications being created.
- Institution changes (a member moving institution, a new institution awaiting office review — these appear in the admin **Alerts** panel instead).
- Account changes (role changes, password resets — the temporary password is shown to the admin, not mailed).
- Voting-eligibility problems and the other admin alerts (Alerts panel only).

## The email log

`email_log` records every send attempt from the background task, with its
own database session:

| Column | Meaning |
|---|---|
| `kind` | The catalogue key above. |
| `recipients` | Final, deduplicated, comma-separated To: list. |
| `subject`, `body` | Exactly what was sent. |
| `status` | `sent` (SMTP accepted it), `failed` (`error` holds the exception), or `disabled` (`SMTP_HOST` unset — what *would* have gone out). |
| `context` | Free text for the log: "talk #12", the publication code, the working group. |
| `person_id` | The member the message is about (link survives deletion as NULL). |
| `actor_user_id` | The account whose action triggered it. |

The Admin → Email tab lists the log newest first with filters by kind and
status and a subject/recipient search; clicking a row shows the full body.
Members cannot see the log (admin only). There is no retention policy yet;
the table grows with the mail volume, which is small.

## Adding a notification

1. Write a `compose`-style function in `notifications.py` returning a
   `Message` (or `None` when nobody is to be told) built from the audience
   helpers; give it a new `kind`, set `person_id` / `actor_user_id` /
   `context` for the log.
2. Call `notifications.queue(background, notifications.<fn>(db, …))` from
   the router, before `db.commit()` (composition needs the live session) —
   the endpoint needs a `background: BackgroundTasks` parameter.
3. Add a row to the catalogue above and cover it in
   `backend/tests/test_api.py` (monkeypatch `app.services.email._deliver` to
   capture the outgoing `EmailMessage`s).
