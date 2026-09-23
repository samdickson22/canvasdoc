export class CanvasAccessError extends Error {
  status: number;
  unavailable: boolean;
  constructor(status: number, unavailable: boolean, message: string) {
    super(message);
    this.name = "CanvasAccessError";
    this.status = status;
    this.unavailable = unavailable;
  }
}
export async function canvasResponseError(
  response: Response,
): Promise<CanvasAccessError> {
  let message = "";
  try {
    const body = await response.json();
    message = typeof body.message === "string" ? body.message : "";
  } catch {}
  const unavailable =
    response.status === 404 &&
    /(?:page|feature|tab).*(?:disabled|not available)/i.test(message);
  let description = `Canvas could not load this data (${response.status}).`;
  if (response.status === 401) {
    description = "Sign in to Canvas to load your work.";
  } else if (unavailable) {
    description = `This course section is unavailable in Canvas (${response.status}).`;
  }
  return new CanvasAccessError(response.status, unavailable, description);
}
