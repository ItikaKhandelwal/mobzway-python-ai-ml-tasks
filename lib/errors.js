export class AppError extends Error {
  constructor(message, status = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function toPublicError(error) {
  if (error instanceof AppError) {
    return { status: error.status, code: error.code, message: error.message };
  }

  console.error("Unexpected server error:", error);
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Something went wrong while generating the answer. Please try again.",
  };
}
