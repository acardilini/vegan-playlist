// Shared error shape for the Band check. Messages are fixed strings: nothing here may carry a token,
// a URL, a request body or a fetch error's message/cause.
const MESSAGES = {
  NOT_FOUND: 'Not found on that source',
  RATE_LIMITED: 'The source is rate-limiting requests - try again in a minute',
  UPSTREAM: 'The source could not be reached',
  UNREADABLE: 'The source page could not be read',
};
const OURS = new Set(['NOT_FOUND', 'RATE_LIMITED', 'UPSTREAM', 'UNREADABLE', 'BAD_INPUT', 'CONFLICT', 'BUSY', 'NO_IDENTITY']);

function coded(code, message) { const e = new Error(message || MESSAGES[code] || code); e.code = code; return e; }

function fromStatus(status) {
  if (status === 429 || status === 503) return coded('RATE_LIMITED');
  if (status === 404) return coded('NOT_FOUND');
  return coded('UPSTREAM');
}

// Normalise anything thrown by a source client into one of our coded errors, dropping its message.
function sourceError(e) {
  if (e && OURS.has(e.code)) return e;
  const status = e && (e.statusCode || e.status);
  return status ? fromStatus(status) : coded('UPSTREAM');
}

module.exports = { MESSAGES, coded, fromStatus, sourceError };
