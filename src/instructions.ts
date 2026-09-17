/** Explicit user preferences only; Canvas content never writes these values. */
export const INSTRUCTION_LIMIT = 4000;
export type Instructions = {
  personal: string;
  courses: Record<string, string>;
};
export type InstructionSnapshot = {
  personal: string;
  course?: { id: number; text: string };
};

export function validateInstruction(text: unknown): asserts text is string {
  if (typeof text !== "string" || text.length > INSTRUCTION_LIMIT)
    throw new Error(
      `Instructions must be at most ${INSTRUCTION_LIMIT.toLocaleString("en-US")} characters.`,
    );
}
export function validateCourseId(id: unknown): asserts id is number {
  if (!Number.isSafeInteger(id) || (id as number) <= 0)
    throw new Error("Invalid instruction course.");
}
export function validateInstructions(
  value: unknown,
): asserts value is Instructions {
  const data = value as Instructions;
  if (
    !data ||
    typeof data !== "object" ||
    !data.courses ||
    typeof data.courses !== "object" ||
    Array.isArray(data.courses)
  )
    throw new Error("Invalid saved instructions.");
  validateInstruction(data.personal);
  for (const [id, text] of Object.entries(data.courses)) {
    validateCourseId(Number(id));
    if (String(Number(id)) !== id)
      throw new Error("Invalid instruction course.");
    validateInstruction(text);
  }
}
export function validateInstructionSnapshot(
  value: unknown,
): asserts value is InstructionSnapshot {
  const snapshot = value as InstructionSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new Error("Invalid instruction snapshot.");
  validateInstruction(snapshot.personal);
  if (snapshot.course !== undefined) {
    if (!snapshot.course || typeof snapshot.course !== "object")
      throw new Error("Invalid instruction course.");
    validateCourseId(snapshot.course.id);
    validateInstruction(snapshot.course.text);
  }
}
export function instructionSnapshot(
  instructions: Instructions | undefined,
  courseId?: number,
): InstructionSnapshot {
  const text = courseId ? instructions?.courses[String(courseId)] : undefined;
  return {
    personal: instructions?.personal ?? "",
    ...(text ? { course: { id: courseId!, text } } : {}),
  };
}

export function instructionEnvelope(snapshot?: InstructionSnapshot): string {
  // An empty snapshot also supersedes preferences from earlier turns of the shared session.
  return `Canvasdoc explicit user instructions for this request (replace earlier saved personal/course instructions; follow personal instructions and the course entry, when present, for this request, including course-associated personal tasks; do not carry these instructions into other requests; empty fields mean no saved instructions; the current user message takes precedence if it conflicts):\n${JSON.stringify(snapshot ?? { personal: "" })}\n\n`;
}
