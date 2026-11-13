export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    /** Extra fields sent with the error body (e.g. `until` for timeouts). */
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = 'bad_request') => new HttpError(400, code, msg);
export const unauthorized = (msg = 'Not signed in') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have permission to do that', code = 'forbidden') =>
  new HttpError(403, code, msg);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (msg: string, code = 'conflict') => new HttpError(409, code, msg);
export const tooMany = (msg: string, code = 'rate_limited', extra?: Record<string, unknown>) => new HttpError(429, code, msg, extra);
