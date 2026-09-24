// Actions that make the server send mail ask the user first, naming who gets
// it. Recipients mirror docs/NOTIFICATIONS.md — keep both in step when a
// notification's audience or trigger changes.
import type { CollabRole } from './api/types'
import { useSession } from './auth/SessionContext'
import { today } from './dates'

export const EMAIL_RECIPIENTS = {
  registration_approved: 'the person (a welcome note with how to sign in)',
  registration_rejected: 'the person (a neutral "not approved" note with the contact address)',
  membership_status_changed: 'the person (naming the old and new status and who changed it)',
  convener_changed: 'the leadership list and the person',
  nomination_submitted: 'the speakers committee',
  speaker_assigned: 'the speaker',
  publication_review_requested: "the admin list and leadership, plus the paper's contacts",
  publication_reviewer_assigned: 'each reviewer added',
  publication_status_changed: "the paper's contacts",
} as const

export type EmailKind = keyof typeof EMAIL_RECIPIENTS

interface ConfirmOptions {
  /** A line between the question and the email notice (what else the action does). */
  extra?: string
  /** Ask even when no mail would go out — for actions that warrant a
   * confirmation of their own (a delete, a revoke). */
  always?: boolean
}

/** Confirm dialog for an action that sends mail. Returns whether to go ahead.
 * When the server has no mail delivery configured nothing is sent, so the
 * action proceeds without asking unless `always` is set. */
export function useEmailConfirm() {
  const { me } = useSession()
  const enabled = me?.email_enabled ?? true
  return (question: string, kind: EmailKind, opts: ConfirmOptions = {}): boolean => {
    const lines = [question]
    if (opts.extra) lines.push(opts.extra)
    if (enabled) lines.push(`This sends an email to ${EMAIL_RECIPIENTS[kind]}.`)
    else if (!opts.always) return true
    return window.confirm(lines.join('\n\n'))
  }
}

const isOpen = (r: Pick<CollabRole, 'end_date'>) => !r.end_date || r.end_date >= today()

/** Which convener changes mail leadership and the person (convener_changed):
 * adding an open convener role, and ending, deleting or back-dating the end
 * of one that is still open. Other roles, and date edits that leave the
 * term open, send nothing. */
export const convenerChangeEmails = (
  role: Pick<CollabRole, 'role' | 'end_date'>,
  change: 'add' | 'end' | 'delete' | { end_date: string | null },
): boolean => {
  if (role.role !== 'convener') return false
  if (change === 'add') return true
  if (!isOpen(role)) return false
  if (change === 'end' || change === 'delete') return true
  return !!change.end_date && change.end_date <= today()
}
