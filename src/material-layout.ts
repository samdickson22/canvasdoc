export function materialSlug(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
      .replace(/[\s_-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 90) || "untitled"
  );
}
export function courseFolder(id: number, name: string): string {
  return `${materialSlug(name)}--${id}`;
}
export function resourceName(id: number | string, name: string): string {
  return `${materialSlug(name)}--${id}`;
}
export function validMaterialPath(relative: string, courseId: number): boolean {
  const parts = relative.split("/");
  if (
    parts.some(
      (part) =>
        !part || part === "." || part === ".." || /[\\\x00-\x1f]/.test(part),
    )
  )
    return false;
  if (parts[0] !== `course-${courseId}` && !parts[0].endsWith(`--${courseId}`))
    return false;
  return (
    parts[1] === "materials" ||
    (parts[1] === "assignments" &&
      /^(?:\d+|[^/]+--\d+)$/.test(parts[2] || "") &&
      parts[3] === "sources")
  );
}
