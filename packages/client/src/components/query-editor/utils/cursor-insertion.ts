/**
 * Result of inserting an identifier into editor content.
 */
export interface InsertionResult {
  /** The new editor content with the identifier inserted */
  content: string;
  /** The new cursor position (immediately after the inserted identifier) */
  cursorPosition: number;
}

/**
 * Inserts an identifier at the specified cursor position in the editor content.
 * If cursor position is invalid (negative, beyond content length, or undefined),
 * the identifier is appended at the end.
 *
 * @param content - The current editor content
 * @param cursorPosition - The position at which to insert the identifier
 * @param identifier - The identifier to insert (e.g., table name or column name)
 * @returns The new content and cursor position
 */
export function insertAtCursor(
  content: string,
  cursorPosition: number | undefined | null,
  identifier: string
): InsertionResult {
  const isValidPosition =
    cursorPosition != null &&
    Number.isFinite(cursorPosition) &&
    cursorPosition >= 0 &&
    cursorPosition <= content.length;

  const insertPos = isValidPosition ? cursorPosition : content.length;

  const newContent =
    content.slice(0, insertPos) + identifier + content.slice(insertPos);

  return {
    content: newContent,
    cursorPosition: insertPos + identifier.length,
  };
}
