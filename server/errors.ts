export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue<T>(
  value: T | null | undefined,
  message = "Not found.",
): T {
  if (value == null) throw new ApiError(404, "not_found", message);
  return value;
}
export function textField(
  input: unknown,
  name: string,
  min: number,
  max: number,
): string {
  if (
    typeof input !== "string" ||
    input.trim().length < min ||
    input.trim().length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)
  )
    throw new ApiError(
      400,
      "invalid_input",
      `${name} must contain ${min}–${max} characters.`,
    );
  return input.trim();
}
export function objectBody(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "invalid_input", "An object body is required.");
  return input as Record<string, unknown>;
}
