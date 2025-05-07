class StoreError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(cause ? `${message} caused by ${cause}` : message);
    this.name = this.constructor.name;

    const causeError =
      cause instanceof Error ? cause : cause ? new Error(String(cause)) : undefined;
    if (causeError?.stack) {
      this.stack = causeError.stack;
    }
  }
}

class ConnectionError extends StoreError {}

class DocumentNotFoundError extends StoreError {
  public readonly id: string;

  constructor(id: string) {
    super(`Document ${id} not found`);
    this.id = id;
  }
}

export { StoreError, ConnectionError, DocumentNotFoundError };
