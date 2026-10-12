export const normalizePlace = value => String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\bbangalore\b/g, 'bengaluru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const generic = new Set(['park', 'workshop', 'event', 'restaurant', 'cafe', 'place', 'trail', 'beach']);

export function referenceFacts(reference) {
  const seen = new Set();
  return (reference?.sources || []).flatMap(source => {
    const segments = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(source.excerpt || '')].map(part => part.segment.trim().replace(/\s+/g, ' '));
    return segments.filter(text => {
      if (text.length < 35 || text.length > 280 || /[\[\]{}]/.test(text) || seen.has(text)) return false;
      seen.add(text); return true;
    }).map(text => ({ text, sourceId: source.id }));
  }).slice(0, 10).map((fact, index) => ({ id: `fact-${index + 1}`, ...fact }));
}

export async function lookupPlaceReference(place, area = '', fetcher = fetch) {
  const name = normalizePlace(place), city = normalizePlace(area).replace(/^near /, '');
  const checkedAt = new Date().toISOString(), missing = status => ({ status, checkedAt, sources: [] });
  if (name.length < 3 || generic.has(name)) return missing('needs_place');
  const base = { action: 'query', prop: 'extracts|info|pageprops', ppprop: 'disambiguation', exintro: '1', explaintext: '1', exchars: '2200', inprop: 'url', format: 'json' };
  async function query(parameters, allowRedirect) {
    const response = await fetcher(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ ...base, ...parameters })}`, { headers: { 'User-Agent': 'RoamLocalPrototype/0.3 (place reference check)' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Reference unavailable');
    const body = await response.json();
    const pages = Object.values(body.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const redirects = body.query?.redirects || [];
    const match = pages.find(page => {
      if (!page.extract || !page.fullurl || page.missing !== undefined || page.pageprops?.disambiguation !== undefined) return false;
      const title = normalizePlace(page.title), extract = normalizePlace(page.extract);
      // Token overlap is not an exact place match. Only a Wikipedia-confirmed
      // redirect from the supplied title may resolve to a different title.
      const nameMatch = title === name || (allowRedirect && redirects.some(redirect => normalizePlace(redirect.from) === name && normalizePlace(redirect.to) === title));
      return nameMatch && (!city || city.split(' ').every(word => extract.split(' ').includes(word)));
    });
    if (!match) return null;
    let url; try { url = new URL(match.fullurl); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname !== 'en.wikipedia.org' || !url.pathname.startsWith('/wiki/')) return null;
    return { status: 'reference_found', checkedAt, sources: [{ id: `wiki-${match.pageid}`, title: String(match.title).slice(0, 150), url: url.href, excerpt: String(match.extract).slice(0, 2200), publisher: 'Wikipedia' }] };
  }
  try {
    const direct = await query({ titles: String(place).trim(), redirects: '1' }, true);
    if (direct) return direct;
    return await query({ generator: 'search', gsrsearch: [place, area].filter(Boolean).join(' '), gsrlimit: '3', gsrnamespace: '0' }, false) || missing('not_found');
  } catch { return missing('unavailable'); }
}

export function validateExpandedStory(raw, reference, notes) {
  if (!Array.isArray(raw?.lines) || raw.lines.length < 4 || raw.lines.length > 8) throw new Error('Gemma did not return 4–8 summary lines. Your notes are safe; try again.');
  const facts = referenceFacts(reference);
  const lines = raw.lines.map(line => {
    if (!line || typeof line.text !== 'string' || !line.text.trim() || line.text.length > 280 || /[\r\n]/.test(line.text) || !['memory', 'context', 'guidance'].includes(line.kind)) throw new Error('Gemma returned an invalid summary line. Try again.');
    if (line.kind === 'context' && (reference.status !== 'reference_found' || !facts.some(fact => fact.sourceId === line.sourceId && fact.text === line.text))) throw new Error('Gemma added place information absent from the checked source. Try again.');
    if (line.kind === 'memory') for (const phrase of ['yesterday', 'today', 'last night', 'this morning', 'this afternoon', 'last weekend']) if (line.text.toLowerCase().includes(phrase) && !notes.toLowerCase().includes(phrase)) throw new Error('Gemma added a visit time absent from your notes. Try again.');
    return { text: line.text.trim(), kind: line.kind, sourceId: line.kind === 'context' ? line.sourceId : null };
  });
  if (!lines.some(line => line.kind === 'memory')) throw new Error('Gemma missed your experience. Try again.');
  return { lines, caption: lines.map(line => `${line.kind === 'context' ? 'Place context: ' : line.kind === 'guidance' ? 'Before you go: ' : ''}${line.text}`).join('\n') };
}
