// Errors the API sends back to the apps, always as { error: "message the user can read" }.

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Please log in') => new HttpError(401, msg);
export const forbidden = (msg = 'Not allowed for your account') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No such API: ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON' });
  }
  // PostgreSQL error codes: 23503 = points to something that doesn't exist, 23505 = duplicate.
  if (err.code === '23503') return res.status(400).json({ error: 'Something you referred to does not exist' });
  if (err.code === '23505') return res.status(409).json({ error: 'This already exists' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}
