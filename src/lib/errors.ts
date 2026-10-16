import type { AppErrorShape } from "@/types/ipc";

export class AppError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
  }
}

function isShape(e: unknown): e is AppErrorShape {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as AppErrorShape).kind === "string" &&
    typeof (e as AppErrorShape).message === "string"
  );
}

/** Normalizes anything thrown by `invoke` into an `AppError`. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (isShape(e)) return new AppError(e.kind, e.message);
  if (e instanceof Error) return new AppError("unknown", e.message);
  if (typeof e === "string") return new AppError("unknown", e);
  return new AppError("unknown", "Something went wrong.");
}

export function errorMessage(e: unknown): string {
  return toAppError(e).message;
}
