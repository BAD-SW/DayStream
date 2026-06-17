import { adminPool } from '../db/pool';

/**
 * Get all published courses for a tenant.
 */
export async function getCourses(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM courses WHERE tenant_id = $1 AND status = 'published' ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

/**
 * Get course detail with lessons.
 */
export async function getCourseDetail(id: string) {
  const { rows: courses } = await adminPool.query(
    `SELECT * FROM courses WHERE id = $1`,
    [id],
  );
  if (courses.length === 0) return null;

  const { rows: lessons } = await adminPool.query(
    `SELECT * FROM course_lessons WHERE course_id = $1 ORDER BY display_order ASC`,
    [id],
  );

  return { ...courses[0], lessons };
}

/**
 * Enroll a customer in a course.
 */
export async function enrollInCourse(courseId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `INSERT INTO course_enrollments (course_id, customer_id)
     VALUES ($1, $2)
     ON CONFLICT (course_id, customer_id) DO NOTHING
     RETURNING *`,
    [courseId, customerId],
  );
  return rows[0] || null;
}

/**
 * Complete a lesson. Increments lessons_completed on the enrollment
 * and marks completed_at if all lessons are done.
 */
export async function completeLesson(enrollmentId: string, lessonId: string) {
  // Mark the lesson as completed
  await adminPool.query(
    `INSERT INTO course_lesson_progress (enrollment_id, lesson_id, completed, completed_at)
     VALUES ($1, $2, true, NOW())
     ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET completed = true, completed_at = NOW()`,
    [enrollmentId, lessonId],
  );

  // Get enrollment and total lesson count
  const { rows: enrollments } = await adminPool.query(
    `SELECT ce.*, c.total_lessons
     FROM course_enrollments ce
     JOIN courses c ON c.id = ce.course_id
     WHERE ce.id = $1`,
    [enrollmentId],
  );

  if (enrollments.length === 0) return null;

  const enrollment = enrollments[0];
  const newCompleted = enrollment.lessons_completed + 1;
  const isFullyCompleted = newCompleted >= enrollment.total_lessons;

  const { rows } = await adminPool.query(
    `UPDATE course_enrollments
     SET lessons_completed = $2,
         status = CASE WHEN $3 THEN 'completed' ELSE status END,
         completed_at = CASE WHEN $3 THEN NOW() ELSE completed_at END
     WHERE id = $1
     RETURNING *`,
    [enrollmentId, newCompleted, isFullyCompleted],
  );

  return rows[0];
}

/**
 * Get a customer's enrollments.
 */
export async function getMyEnrollments(customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT ce.*, c.title, c.image_path, c.total_lessons
     FROM course_enrollments ce
     JOIN courses c ON c.id = ce.course_id
     WHERE ce.customer_id = $1
     ORDER BY ce.enrolled_at DESC`,
    [customerId],
  );
  return rows;
}
