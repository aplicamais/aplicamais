/*
 * AplicaMais — Service Worker
 * Responsável por: cache dos arquivos principais, funcionamento offline,
 * atualização automática e limpeza de caches antigos.
 * Não altera nenhum comportamento do app — apenas intercepta requisições
 * de rede para servir do cache quando possível.
 */

// Suba este número sempre que publicar uma nova versão do app
// (isso força o Service Worker a atualizar o cache automaticamente).
const SW_VERSION = 'v10';
const CACHE_NAME = 'aplicamais-cache-' + SW_VERSION;
// FASE 6 · ETAPA 2 — caches que sobrevivem às atualizações de versão.
// Bibliotecas têm a versão no próprio endereço, então nunca ficam "velhas".
const LIBS_CACHE = 'aplicamais-libs-v1';
const IMG_CACHE = 'aplicamais-img-v1';
const IMG_MAX = 150; // limite de imagens externas guardadas (evita encher o celular)
const LIBS = [
    'https://cdn.jsdelivr.net/npm/promise-polyfill@8.3.0/dist/polyfill.min.js',
    'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js',
    'https://www.gstatic.com/firebasejs/8.10.1/firebase-storage.js',
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.0/dist/confetti.browser.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://unpkg.com/docx@8.5.0/build/index.js',
    'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];
const LIB_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com'];
const IMG_HOSTS = ['api.dicebear.com', 'images.unsplash.com', 'cdn.pixabay.com', 'fonts.gstatic.com', 'firebasestorage.googleapis.com', 'storage.googleapis.com'];
// Endereços que NUNCA devem ser guardados (dados que mudam: banco, ranking, jogos ao vivo).
function ehDadoAoVivo(url) {
    return url.indexOf('firebaseio.com') !== -1 || url.indexOf('firebasedatabase.app') !== -1 || url.indexOf('formsubmit.co') !== -1;
}
function limitarCache(nome, max) {
    caches.open(nome).then(function (c) {
        c.keys().then(function (ks) {
            if (ks.length <= max) return;
            ks.slice(0, ks.length - max).forEach(function (k) { c.delete(k); });
        });
    });
}

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
    event.waitUntil(Promise.all([
        caches.open(CACHE_NAME).then(function (cache) {
            return Promise.all(
                APP_SHELL.map(function (url) {
                    return cache.add(url).catch(function () {
                        // Ignora falhas individuais (ex.: 404 de um ícone específico)
                        // para não travar a instalação do Service Worker inteiro.
                    });
                })
            );
        }),
        // FASE 6: guarda as bibliotecas para o app abrir sem internet.
        caches.open(LIBS_CACHE).then(function (cache) {
            return Promise.all(LIBS.map(function (url) {
                return cache.match(url).then(function (ja) {
                    if (ja) return;
                    return fetch(url, { mode: 'cors' }).then(function (r) {
                        if (r && r.ok) return cache.put(url, r);
                    }).catch(function () {});
                });
            }));
        })
    ]));
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
    // FASE 5: a nova versão só é ativada quando o usuário toca em
    // "Atualizar agora" no pop-up (mensagem APLICA_UPDATE_NOW). O antigo
    // 'SKIP_WAITING' automático é ignorado para não atualizar sem aviso.
    if (!event.data) return;
    if (event.data.type === 'APLICA_UPDATE_NOW') self.skipWaiting();
    if (event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage(SW_VERSION);
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

    // CORREÇÃO (banco antigo / vídeo de splash antigo aparecendo primeiro em
    // outros aparelhos): este handler tratava QUALQUER requisição GET —
    // inclusive as de outras origens, como as chamadas REST ao Firebase
    // Realtime Database (usadas como fallback para ler matérias/banco de
    // questões) e a URL externa do vídeo/imagem da tela de abertura. Elas
    // caíam na estratégia "cache-first" lá embaixo: a PRIMEIRA visita depois
    // de qualquer atualização servia a resposta antiga que já estava em
    // cache, e só atualizava o cache em segundo plano — por isso o usuário
    // via o banco/vídeo antigo e, só depois de recarregar a página (quando o
    // cache já tinha sido atualizado pela revalidação em segundo plano), via
    // a versão nova. Esses dados mudam com frequência e não fazem parte do
    // app shell, então não devem ser interceptados/cacheados por este Service
    // Worker — deixamos o navegador buscá-los normalmente na rede.
    if (!request.url.startsWith(self.location.origin)) {
        // FASE 6 · ETAPA 2: bibliotecas e imagens externas também funcionam offline.
        // O banco de questões/ranking (Firebase Realtime Database) continua
        // SEMPRE indo à rede — a cópia offline dele fica no aparelho (Etapa 1).
        if (ehDadoAoVivo(request.url)) return;
        var host = '';
        try { host = new URL(request.url).hostname; } catch (e) { return; }
        if (LIB_HOSTS.indexOf(host) !== -1 && request.destination !== 'image') {
            // Cache-first: versão está no endereço, então a cópia nunca fica velha.
            event.respondWith(caches.open(LIBS_CACHE).then(function (cache) {
                return cache.match(request).then(function (hit) {
                    if (hit) return hit;
                    return fetch(request).then(function (r) {
                        if (r && (r.ok || r.type === 'opaque')) cache.put(request, r.clone());
                        return r;
                    });
                });
            }));
            return;
        }
        if (request.destination === 'image' || IMG_HOSTS.indexOf(host) !== -1) {
            // Imagens: mostra a guardada na hora e atualiza em segundo plano.
            event.respondWith(caches.open(IMG_CACHE).then(function (cache) {
                return cache.match(request).then(function (hit) {
                    var rede = fetch(request).then(function (r) {
                        if (r && (r.ok || r.type === 'opaque')) {
                            cache.put(request, r.clone()).then(function () { limitarCache(IMG_CACHE, IMG_MAX); });
                        }
                        return r;
                    }).catch(function () { return hit || Response.error(); });
                    return hit || rede;
                });
            }));
            return;
        }
        return;
    }

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
                    var rede = preloaded ? Promise.resolve(preloaded) : fetch(request, { cache: 'no-store' });
                    // FASE 6: internet lenta — se a rede não responder em 4s e já
                    // existir uma cópia guardada, abre com ela (a rede continua
                    // baixando e atualiza a cópia para a próxima vez).
                    var lenta = new Promise(function (resolve, reject) {
                        setTimeout(function () {
                            caches.match(request).then(function (c) {
                                return c || caches.match('./index.html');
                            }).then(function (c) { if (c) resolve(c); });
                        }, 4000);
                        rede.catch(reject);
                    });
                    rede.then(function (r) {
                        if (r && r.ok) { var cp = r.clone(); caches.open(CACHE_NAME).then(function (cache) { cache.put(request, cp); }); }
                    }).catch(function () {});
                    return Promise.race([rede, lenta]);
                })
                .then(function (response) {
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
