// Azure AI Translator (Text Translation v3) for the lines of a budget PDF that
// are not in Spanish, so they can be matched against the base de partidas.
// Configured with AZURE_TRANSLATOR_KEY, AZURE_TRANSLATOR_REGION and optionally
// AZURE_TRANSLATOR_ENDPOINT; without them nothing is translated.
const DEFAULT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';

export class AzureTranslator {
  constructor({ key, region, endpoint = DEFAULT_ENDPOINT, fetcher = fetch } = {}) {
    this.key = key; this.region = region; this.endpoint = endpoint.replace(/\/$/, ''); this.fetch = fetcher;
  }

  // texts → [{ text (Spanish), from (detected language) }], same order.
  // Batches of up to 100 texts / 40 000 characters per request (service limits: 1000 / 50 000).
  async translate(texts) {
    const out = new Array(texts.length).fill(null);
    let batch = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const r = await this.fetch(`${this.endpoint}/translate?api-version=3.0&to=es`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': this.key, ...(this.region ? { 'Ocp-Apim-Subscription-Region': this.region } : {}) },
        body: JSON.stringify(batch.map(([, text]) => ({ Text: text }))),
      });
      if (!r.ok) throw new Error(`traductor ${r.status}`);
      const res = await r.json();
      batch.forEach(([i, text], k) => {
        const x = res[k];
        out[i] = { text: x?.translations?.[0]?.text || text, from: x?.detectedLanguage?.language || null };
      });
      batch = []; size = 0;
    };
    for (const [i, raw] of texts.entries()) {
      const text = String(raw || '').slice(0, 5000);
      if (!text.trim()) { out[i] = { text, from: 'es' }; continue; }
      if (batch.length >= 100 || size + text.length > 40000) await flush();
      batch.push([i, text]); size += text.length;
    }
    await flush();
    return out;
  }
}

export function translatorFromEnv(env = process.env) {
  return env.AZURE_TRANSLATOR_KEY ? new AzureTranslator({ key: env.AZURE_TRANSLATOR_KEY, region: env.AZURE_TRANSLATOR_REGION, endpoint: env.AZURE_TRANSLATOR_ENDPOINT || undefined }) : null;
}
