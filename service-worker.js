/*
 * AplicaMais — Service Worker
 * Responsável por: cache dos arquivos principais, funcionamento offline,
 * atualização automática e limpeza de caches antigos.
 * Não altera nenhum comportamento do app — apenas intercepta requisições
 * de rede para servir do cache quando possível.
 */

// Suba este número sempre que publicar uma nova versão do app
// (isso força o Service Worker a atualizar o cache automaticamente).
const SW_VERSION = 'v4';
const CACHE_NAME = 'aplicamais-cache-' + SW_VERSION;

// Arquivos essenciais para o app abrir offline (app shell).
const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './icons/favicon.ico',
    './icons/favicon.png',
    './icons/icon-72.png',
    './icons/icon-96.png',
    './icons/icon-128.png',
    './icons/icon-144.png',
    './icons/icon-152.png',
    './icons/icon-180.png',
    './icons/icon-192.png',
    './icons/icon-384.png',
    './icons/icon-512.png',
    './icons/icon-512-maskable.png'
];

// ---------- INSTALL ----------
// Faz cache do app shell. Não interrompe a instalação se algum
// arquivo opcional falhar (ex.: ícone ainda não publicado).
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return Promise.all(
                APP_SHELL.map(function (url) {
                    return cache.add(url).catch(function () {
                        // Ignora falhas individuais (ex.: 404 de um ícone específico)
                        // para não travar a instalação do Service Worker inteiro.
                    });
                })
            );
        })
    );
    // Não força skipWaiting aqui: a troca de versão é controlada
    // pela mensagem SKIP_WAITING enviada pelo index.html, evitando
    // atualizar o app no meio de uma sessão ativa do usuário.
});

// ---------- ACTIVATE ----------
// Remove caches de versões antigas para não acumular espaço em disco.
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys
                    .filter(function (key) {
                        return key.indexOf('aplicamais-cache-') === 0 && key !== CACHE_NAME;
                    })
                    .map(function (key) {
                        return caches.delete(key);
                    })
            );
        }).then(function () {
            // Ativa Navigation Preload quando suportado (acelera a navegação
            // sem alterar a estratégia network-first já usada abaixo).
            if (self.registration.navigationPreload) {
                return self.registration.navigationPreload.enable();
            }
        }).then(function () {
            return self.clients.claim();
        })
    );
});

// ---------- MESSAGE ----------
// Permite que o index.html force a ativação da nova versão
// assim que ela terminar de instalar (ver script de registro no index.html).
self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// ---------- FETCH ----------
// Estratégia:
//  - Navegação (abrir o app / index.html): network-first com fallback pro cache,
//    assim o usuário sempre vê a versão mais nova quando está online,
//    e o app ainda abre offline usando o que já foi cacheado.
//  - Demais recursos (ícones, manifest, etc.): cache-first com atualização
//    em segundo plano (stale-while-revalidate), pra carregar rápido e
//    ainda manter o cache atualizado quando há conexão.
self.addEventListener('fetch', function (event) {
    const request = event.request;

    // Só trata requisições GET do mesmo tipo de esquema (http/https).
    if (request.method !== 'GET' || !request.url.startsWith('http')) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            Promise.resolve(event.preloadResponse)
                .then(function (preloaded) {
                    // cache:'no-store' ignora o cache HTTP do próprio navegador (não
                    // só o cache deste Service Worker). O GitHub Pages manda cabeçalhos
                    // de Cache-Control no index.html; sem isso, um fetch "normal" pode
                    // ser respondido direto do cache HTTP do navegador sem nem chegar
                    // a ir à rede — por isso o app parecia "network-first" mas continuava
                    // servindo a versão antiga assim que hospedado (funcionava local
                    // porque abrir o arquivo direto não passa por cache HTTP nenhum).
                    return preloaded || fetch(request, { cache: 'no-store' });
                })
                .then(function (response) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(request, copy);
                    });
                    return response;
                })
                .catch(function () {
                    return caches.match(request).then(function (cached) {
                        return cached || caches.match('./index.html');
                    });
                })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(function (cached) {
            const networkFetch = fetch(request)
                .then(function (response) {
                    // Só cacheia respostas válidas (evita gravar erros/opacas de terceiros)
                    if (response && response.status === 200 && response.type === 'basic') {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(function (cache) {
                            cache.put(request, copy);
                        });
                    }
                    return response;
                })
                .catch(function () {
                    return cached;
                });
            return cached || networkFetch;
        })
    );
});
