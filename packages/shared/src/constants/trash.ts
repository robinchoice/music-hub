// Deleted tracks, versions, stems and comments stay in the project's trash this long
export const TRASH_DAYS = 30;

// A rejection with a reason writes a comment with this prefix, so older clients can read the reason.
// Lists leave these comments out and carry the text as rejectionReason instead.
export const REJECTION_PREFIX = '❌ Abgelehnt: ';
