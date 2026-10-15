export type EngineErrorCode =
  | 'not_pdf'
  | 'password'
  | 'damaged'
  | 'no_text'
  | 'timeout'
  | 'too_big'
  | 'bad_password'
  | 'failed';

// Error esperado del motor: el código decide qué mensaje amable ve el cliente.
export class EngineError extends Error {
  constructor(readonly code: EngineErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'EngineError';
  }
}
