// Service worker: guarda uma copia do app no aparelho para ele abrir sem internet.
// Com internet, busca sempre a versao nova (e atualiza a copia); sem internet, ou se a rede demorar, usa a copia.
// So passam por aqui os arquivos do proprio app: Google (Drive, login, Agenda, Maps), AeroDataBox, bandeiras,
// logos e as outras APIs vao direto a rede. Dados no localStorage e recibos no IndexedDB nao mudam.
const CACHE = 'controle-diario-app';
const BASICOS = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await c.addAll(BASICOS);
  // calc.js e icones.js entram com o mesmo endereco (inclusive ?v=, se houver) que a pagina pede
  const pagina = await (await c.match('./')).text();
  const scripts = [...pagina.matchAll(/<script src="((?:calc|icones)\.js(?:\?v=[\w.]+)?)"/g)].map((m) => m[1]);
  await c.addAll(scripts);
  self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // so apaga caches antigos deste app (o endereco github.io e o mesmo do Carteira BDR e do Prev Jr)
  for (const k of await caches.keys()) if (k.startsWith('controle-diario-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.searchParams.has('ping')) return; // conferencia de conexao: sempre na rede
  if (url.origin === location.origin) e.respondWith(redePrimeiro(req));
});

// Pagina e arquivos do app: tenta a rede (ate 4 s); deu certo, atualiza a copia; senao, usa a copia.
async function redePrimeiro(req) {
  const c = await caches.open(CACHE);
  const navegacao = req.mode === 'navigate';
  const rede = fetch(req).then((r) => {
    if (r.ok) c.put(navegacao ? './' : req, r.clone());
    return r;
  });
  try {
    return await Promise.race([rede, new Promise((_, nao) => setTimeout(() => nao(new Error('lenta')), 4000))]);
  } catch {
    return (await c.match(navegacao ? './' : req, { ignoreSearch: navegacao })) || rede; // sem copia, espera a rede
  }
}
