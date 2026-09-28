class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps async controllers so rejected promises reach the error handler
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const notFound = (req, res, next) =>
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));

// Centralized error handler
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (err.name === 'ValidationError') {
    const msgs = Object.values(err.errors).map(e => e.message).join('; ');
    return res.status(400).json({ error: `Validation failed: ${msgs}` });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid ${err.path}: "${err.value}" is not a valid identifier.` });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {}).join(', ');
    return res.status(409).json({ error: `Duplicate value for: ${field}. A record with this value already exists.` });
  }
  console.error('[RAKSHA] Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error. Check the server console for details.' });
}

module.exports = { ApiError, asyncHandler, notFound, errorHandler };