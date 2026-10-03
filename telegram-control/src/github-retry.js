const TRANSIENT_STATUS = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = [250, 750];

// Leituras podem ser repetidas com segurança. Escritas (inclusive dispatch)
// não podem: uma resposta perdida não significa que o GitHub não as aplicou.
export async function githubFetch(fetchImpl, url, options = {}, sleep = setTimeout) {
  if ((options.method || "GET").toUpperCase() !== "GET") {
    return fetchImpl(url, options);
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchImpl(url, options);
      if (!TRANSIENT_STATUS.has(response.status) || attempt >= RETRY_DELAYS_MS.length) {
        return response;
      }
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
    }
    await new Promise((resolve) => sleep(resolve, RETRY_DELAYS_MS[attempt]));
  }
}
