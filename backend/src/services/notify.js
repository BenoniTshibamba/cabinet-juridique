import { query } from '../db/pool.js';

export async function notify(userId, { type, title, body = null, caseId = null }) {
  await query(
    `INSERT INTO notifications (user_id, type, title, body, related_case_id) VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, title, body, caseId],
  );
}

/** Notifie plusieurs destinataires en une fois (ex. tous les admins). */
export async function notifyMany(userIds, payload) {
  await Promise.all(userIds.map((id) => notify(id, payload)));
}
