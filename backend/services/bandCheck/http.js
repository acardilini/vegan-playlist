// The real network call the Band check adapters use. Adapters take `fetch` by injection so tests never reach this.
async function defaultFetch(url, opts = {}) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
}
module.exports = { defaultFetch };
