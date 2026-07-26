export class DatabaseMaintenanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseMaintenanceError";
    this.code = code;
  }
}

export function maintenanceError(
  code: string,
  message: string,
  cause?: unknown,
): DatabaseMaintenanceError {
  return new DatabaseMaintenanceError(code, message, { cause });
}

export function safeMaintenanceMessage(error: unknown): string {
  return error instanceof DatabaseMaintenanceError
    ? error.message.slice(0, 200)
    : "Database maintenance operation failed safely.";
}

export function safeMaintenanceCode(error: unknown): string {
  return error instanceof DatabaseMaintenanceError &&
    /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : "DATABASE_MAINTENANCE_FAILED";
}
