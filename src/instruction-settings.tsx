import { useState } from "react";
import { INSTRUCTION_LIMIT } from "./instructions";
import { store, useData } from "./store";
import type { Course } from "./types";

export function InstructionSettings({
  courses,
  courseId,
}: {
  courses: Course[];
  courseId?: number;
}) {
  const { instructions } = useData();
  const [scope, setScope] = useState(courseId ? String(courseId) : "personal");
  const courseIds = new Set([
    ...courses.map((course) => course.id),
    ...Object.keys(instructions?.courses ?? {}).map(Number),
    ...(courseId ? [courseId] : []),
  ]);
  return (
    <section className="instruction-settings">
      <h3>Instructions</h3>
      <p className="muted">
        Tell the agent how you want help. Saved in this browser for your Canvas
        account, even while disconnected. Changes apply to new messages.
      </p>
      <label className="instruction-scope">
        Apply to
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="personal">All conversations</option>
          {[...courseIds].map((id) => (
            <option key={id} value={id}>
              {courses.find((course) => course.id === id)?.name ??
                `Course ${id}`}
            </option>
          ))}
        </select>
      </label>
      <InstructionEditor
        key={scope}
        courseId={scope === "personal" ? undefined : Number(scope)}
        saved={
          scope === "personal"
            ? (instructions?.personal ?? "")
            : (instructions?.courses[scope] ?? "")
        }
      />
    </section>
  );
}
function InstructionEditor({
  courseId,
  saved,
}: {
  courseId?: number;
  saved: string;
}) {
  const [text, setText] = useState(saved);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(value: string) {
    setSaving(true);
    try {
      if (await store.saveInstructions(value, courseId)) {
        setText(value.trim());
        setStatus(
          value.trim() ? "Instructions saved." : "Instructions removed.",
        );
      } else setStatus(store.error());
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="connection-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(text);
      }}
    >
      <label>
        {courseId ? "Course instructions" : "Personal instructions"}
        <textarea
          rows={4}
          maxLength={INSTRUCTION_LIMIT}
          value={text}
          disabled={saving}
          onChange={(event) => {
            setText(event.target.value);
            setStatus("");
          }}
          placeholder={
            courseId
              ? "For this course, help me work through examples step by step."
              : "Keep explanations concise and ask me to try before showing the answer."
          }
        />
      </label>
      <span className="muted">
        {text.length.toLocaleString()} / {INSTRUCTION_LIMIT.toLocaleString()}{" "}
        characters. Leave blank to remove.
      </span>
      <div className="instruction-actions">
        <button className="primary-button" disabled={saving}>
          Save instructions
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={saving || (!text && !saved)}
          onClick={() => void save("")}
        >
          Remove instructions
        </button>
      </div>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
