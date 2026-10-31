// Relais Cloudflare Worker : code-barres -> fiche produit (Open Food Facts), avec cache et en-tête CORS.
const CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };
const out = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });
export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (u.searchParams.has('ping')) return out({ pong: 1 });
    const ean = (u.searchParams.get('ean') || '').replace(/\D/g, '');
    if (ean.length < 8 || ean.length > 14) return out({ ok: 0, error: 'ean' }, 400);
    const api = `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_fr,brands,quantity,image_front_small_url`;
    const r = await fetch(api, { headers: { 'user-agent': 'MesCourses/1.0 (usage personnel)' }, cf: { cacheTtl: 86400, cacheEverything: true } });
    const j = await r.json().catch(() => ({}));
    if (!j.product) return out({ ok: 0, error: 'unknown' });
    const p = j.product;
    return out({ ok: 1, name: p.product_name_fr || p.product_name || '', brand: (p.brands || '').split(',')[0].trim(), quantity: p.quantity || '', image: p.image_front_small_url || '' });
  }
};
