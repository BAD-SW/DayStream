import { adminPool } from '../db/pool';

/**
 * List dependencies for a resource.
 */
export async function getDependencies(resourceId: string) {
  const { rows } = await adminPool.query(
    `SELECT rd.*, r.name AS depends_on_name, r.resource_type_id, rt.name AS type_name
     FROM resource_dependencies rd
     JOIN resources r ON r.id = rd.depends_on_id
     JOIN resource_types rt ON rt.id = r.resource_type_id
     WHERE rd.resource_id = $1 ORDER BY r.name`,
    [resourceId]);
  return rows;
}

/**
 * Add a dependency.
 */
export async function addDependency(resourceId: string, input: {
  dependsOnId: string;
  offsetMinutes?: number;
  durationMinutes?: number;
}) {
  // Prevent circular dependencies
  if (resourceId === input.dependsOnId) throw new Error('Resource cannot depend on itself');

  // Check if the dependency already depends on this resource (circular)
  const { rows: reverse } = await adminPool.query(
    `SELECT id FROM resource_dependencies WHERE resource_id = $1 AND depends_on_id = $2`,
    [input.dependsOnId, resourceId]);
  if (reverse.length > 0) throw new Error('Circular dependency detected');

  const { rows } = await adminPool.query(
    `INSERT INTO resource_dependencies (resource_id, depends_on_id, offset_minutes, duration_minutes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [resourceId, input.dependsOnId, input.offsetMinutes ?? 0, input.durationMinutes ?? null]);
  return rows[0];
}

/**
 * Remove a dependency.
 */
export async function removeDependency(id: string, resourceId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM resource_dependencies WHERE id = $1 AND resource_id = $2`, [id, resourceId]);
  return (rowCount ?? 0) > 0;
}
