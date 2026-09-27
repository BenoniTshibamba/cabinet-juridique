import { query } from '../db/pool.js';

/**
 * Enregistre une entrée d'audit. Ne doit jamais faire échouer la requête HTTP qui l'a déclenchée :
 * une panne de journalisation est loggée sur la console mais avalée.
 */
export async function logAudit({ userId, action, resourceType, resourceId, oldValues, newValues, ip }) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, old_values, new_values, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId ?? null,
        action,
        resourceType,
        resourceId != null ? String(resourceId) : null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ip ?? null,
      ],
    );
  } catch (err) {
    console.error('audit log failed:', err.message);
  }
}
