/**
 * The entries from the session's leaf back to its first message: the conversation as it stands. Entries left on another
 * branch by a rewind stay saved but are not part of it.
 */
export const CHAIN = `WITH RECURSIVE chain(id) AS (
  SELECT leaf_id FROM session WHERE singleton=1 AND leaf_id IS NOT NULL
  UNION ALL SELECT e.parent_id FROM entries e JOIN chain c ON e.id=c.id WHERE e.parent_id IS NOT NULL)`;
