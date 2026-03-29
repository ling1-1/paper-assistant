// lib/literature.js  v3
// 彻底解决 429：CrossRef（主）→ OpenAlex（备）→ SemanticScholar（需Key）
// 内存缓存 + 智能重试 + 完整 GB/T 7714

const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL) { cache.delete(key); return null; }
  return hit.data;
}
function setCache(key, data) {
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(key, { data, ts: Date.now() });
}

async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function withRetry(fn, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === maxRetries) throw err;
      const wait = err.message?.includes('429') ? 2000 * (i + 1) : 500 * Math.pow(2, i);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function searchCrossRef(query, limit) {
  const params = new URLSearchParams({
    query, rows: limit,
    select: 'title,author,published,container-title,DOI,abstract,is-referenced-by-count',
    mailto: 'paperassistant@example.com',
  });
  const res = await fetchWithTimeout(
    `https://api.crossref.org/works?${params}`,
    { headers: { 'User-Agent': 'PaperAssistant/3.0 (mailto:paperassistant@example.com)' } }
  );
  if (!res.ok) throw new Error(`CrossRef ${res.status}`);
  const data = await res.json();
  return (data.message?.items || [])
    .filter(p => p.title?.[0] && p.published?.['date-parts']?.[0]?.[0])
    .slice(0, limit)
    .map(p => {
      const authorNames = (p.author || []).map(a => [a.family, a.given?.charAt(0)].filter(Boolean).join(' ')).slice(0, 10);
      const year = p.published['date-parts'][0][0];
      const venue = p['container-title']?.[0] || '';
      const abstract = (p.abstract || '').replace(/<[^>]+>/g, '').slice(0, 350) || '暂无摘要';
      return { title: p.title[0], authors: authorNames.join(', ') || '未知作者', year, venue, abstract,
        citations: p['is-referenced-by-count'] || 0, doi: p.DOI || null, source: 'CrossRef',
        gbRef: buildGBT({ title: p.title[0], authorNames, year, venue, doi: p.DOI }) };
    });
}

async function searchOpenAlex(query, limit) {
  const params = new URLSearchParams({
    search: query, 'per-page': limit,
    select: 'title,authorships,publication_year,primary_location,doi,abstract_inverted_index,cited_by_count',
    mailto: 'paperassistant@example.com',
  });
  const res = await fetchWithTimeout(
    `https://api.openalex.org/works?${params}`,
    { headers: { 'User-Agent': 'PaperAssistant/3.0' } }
  );
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const data = await res.json();
  return (data.results || []).filter(p => p.title && p.publication_year).slice(0, limit).map(p => {
    const authorNames = (p.authorships || []).map(a => a.author?.display_name || '').filter(Boolean).slice(0, 10);
    const year = p.publication_year;
    const venue = p.primary_location?.source?.display_name || '';
    const doi = p.doi?.replace('https://doi.org/', '') || null;
    let abstract = '暂无摘要';
    if (p.abstract_inverted_index) {
      try {
        const w = {};
        for (const [word, pos] of Object.entries(p.abstract_inverted_index)) pos.forEach(i => { w[i] = word; });
        abstract = Object.keys(w).sort((a,b)=>a-b).map(k=>w[k]).join(' ').slice(0, 350) + '…';
      } catch {}
    }
    return { title: p.title, authors: authorNames.join(', ') || '未知作者', year, venue, abstract,
      citations: p.cited_by_count || 0, doi, source: 'OpenAlex',
      gbRef: buildGBT({ title: p.title, authorNames, year, venue, doi }) };
  });
}

async function searchSemanticScholar(query, limit) {
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (!apiKey) throw new Error('SemanticScholar 未配置 API Key，跳过');
  const params = new URLSearchParams({ query, limit, fields: 'title,authors,year,abstract,citationCount,externalIds,venue' });
  const res = await fetchWithTimeout(
    `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
    { headers: { 'User-Agent': 'PaperAssistant/3.0', 'x-api-key': apiKey } }
  );
  if (!res.ok) throw new Error(`SemanticScholar ${res.status}`);
  const data = await res.json();
  return (data.data || []).filter(p => p.title && p.year).map(p => {
    const authorNames = (p.authors || []).map(a => a.name);
    return { title: p.title, authors: authorNames.join(', ') || '未知作者',
      year: p.year, venue: p.venue || '',
      abstract: p.abstract ? p.abstract.slice(0, 350) + '…' : '暂无摘要',
      citations: p.citationCount || 0, doi: p.externalIds?.DOI || null, source: 'Semantic Scholar',
      gbRef: buildGBT({ title: p.title, authorNames, year: p.year, venue: p.venue, doi: p.externalIds?.DOI }) };
  });
}

async function searchLiterature(query, limit = 6) {
  const cacheKey = `${query.toLowerCase().trim()}__${limit}`;
  const cached = getCached(cacheKey);
  if (cached) { console.log(`[lit] cache hit: "${query}"`); return cached; }

  const sources = [
    { name: 'CrossRef',        fn: () => searchCrossRef(query, limit) },
    { name: 'OpenAlex',        fn: () => searchOpenAlex(query, limit) },
    { name: 'SemanticScholar', fn: () => searchSemanticScholar(query, limit) },
  ];

  for (const src of sources) {
    try {
      console.log(`[lit] trying ${src.name}…`);
      const results = await withRetry(src.fn, 1);
      if (results.length > 0) {
        console.log(`[lit] ${src.name} → ${results.length} results`);
        setCache(cacheKey, results);
        return results;
      }
    } catch (err) {
      console.warn(`[lit] ${src.name} failed: ${err.message}`);
    }
  }
  return [];
}

function buildGBT({ title, authorNames = [], year, venue, doi }) {
  const authorStr = !authorNames.length ? '佚名'
    : authorNames.length <= 3 ? authorNames.join(', ')
    : authorNames.slice(0, 3).join(', ') + ', 等';
  const v = venue ? `[J]. ${venue}` : '[J]';
  const d = doi ? `. DOI: ${doi}` : '';
  return `${authorStr}. ${title}${v}, ${year || '年份不详'}${d}.`;
}

module.exports = { searchLiterature };
