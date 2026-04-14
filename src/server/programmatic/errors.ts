export class ProgrammaticApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ProgrammaticApiError";
    this.status = status;
    this.details = details;
  }
}

export function isProgrammaticApiError(error: unknown): error is ProgrammaticApiError {
  return error instanceof ProgrammaticApiError;
}
