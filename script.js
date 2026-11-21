// ==UserScript==
// @name         GF.util V2
// @namespace    GF.util V2
// @version      0.4.0
// @description  LOL
// @match        https://gofrag.ru/*
// @match        https://byrutgame.org/*
// @match        https://itorrents-igruha.org/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      img.byrutgame.org
// @connect      byrutgame.org
// @connect      itorrents-igruha.org
// @connect      store.steampowered.com
// @connect      gofrag.ru
// @connect      steamcommunity.com
// @connect      images.steamusercontent.com
// @connect      steamuserimages-a.akamaihd.net
// @connect      community.cloudflare.steamstatic.com
// @connect      community.akamai.steamstatic.com
// @updateURL    https://raw.githubusercontent.com/nunemusegan-bot/gf-util-v2/main/script.js
// @downloadURL  https://raw.githubusercontent.com/nunemusegan-bot/gf-util-v2/main/script.js
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const SOURCE_HOSTS = ['byrutgame.org', 'itorrents-igruha.org'];
    const host = location.hostname;
    const onSubmitPage = host === 'gofrag.ru' && location.pathname.indexOf('/component/com_gofrag_game_submit') === 0;
    if (!onSubmitPage && !SOURCE_HOSTS.includes(host)) return;

    function parserEnabled() {
        try {
            const s = GM_getValue('gf_theme_v4', {});
            return !(s && s.parser && s.parser.enabled === false);
        } catch (e) {
            return true;
        }
    }

    const CATEGORY_MAP = {
        'Шутеры': 18,
        'Стратегии': 19,
        'Аркады': 20,
        'Симуляторы': 21,
        'Гонки': 22,
        'РПГ': 23,
        'Экшены': 24,
        'Головоломки': 26,
        'Платформеры': 27,
        'Квесты': 28,
        'Хоррор': 30,
        'Приключения': 31
    };
    const GENRES = Object.keys(CATEGORY_MAP);

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    function normalizeUrl(rawUrl) {
        if (!rawUrl || rawUrl.startsWith('#') || /^javascript:/i.test(rawUrl)) return '';
        try {
            const url = new URL(rawUrl, window.location.href);
            return /^https?:$/i.test(url.protocol) ? url.href : '';
        } catch (e) {
            return '';
        }
    }

    function collectEmbeddedUrls(container) {
        const urls = [];
        container.querySelectorAll('script:not([src])').forEach(script => {
            const matches = script.textContent.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
            matches.forEach(url => { if (!urls.includes(url)) urls.push(url); });
        });
        return urls;
    }

    function htmlToText(html) {
        const container = document.createElement('div');
        container.innerHTML = html;

        const embeddedUrls = collectEmbeddedUrls(container);

        container.querySelectorAll('script, style, svg, noscript, .packagedownld-spoiler').forEach(el => el.remove());

        container.querySelectorAll('a[href], a[link]').forEach(link => {
            const rawUrl = link.getAttribute('href') || link.getAttribute('link');
            const url = normalizeUrl(rawUrl);
            const label = link.textContent.replace(/\s+/g, ' ').trim();
            if (!url) return;
            const replacement = label && label !== url ? `${label}: ${url}` : url;
            link.replaceWith(document.createTextNode(replacement));
        });

        container.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        container.querySelectorAll(
            'p, div, section, article, li, ul, ol, h1, h2, h3, h4, h5, h6, table, tr'
        ).forEach(el => el.append('\n'));
        container.querySelectorAll('td, th').forEach(el => el.append('\t'));

        let text = container.textContent
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const missingUrls = embeddedUrls.filter(url => !text.includes(url));
        if (missingUrls.length) text = [text, missingUrls.join('\n')].filter(Boolean).join('\n\n');

        return text;
    }

    function extractLabeledHtmlSection(containerHtml, labelPattern) {
        const startRe = new RegExp('<b>\\s*(?:' + labelPattern + ')[^<]*:?\\s*</b>', 'i');
        const startMatch = containerHtml.match(startRe);
        if (!startMatch) return '';
        const startIdx = startMatch.index + startMatch[0].length;
        const rest = containerHtml.slice(startIdx);
        const endMatch = rest.match(/<ul[^>]*id=["']navbartor["']|<b>\s*[^<]+:?\s*<\/b>/i);
        const endIdx = endMatch ? endMatch.index : rest.length;
        return htmlToText(rest.slice(0, endIdx)).trim();
    }

    function cleanTitleForSearch(title) {
        if (!title) return '';
        let t = title;
        t = t.replace(/[\(\[][^)\]]*[\)\]]/g, ' ');
        t = t.replace(/\b(RePack|Repack|Portable|Denuvo|Steam[- ]?Rip|GOG|Build\s*\d+|v\d[\d.]*|от\s+\S+)\b.*/i, '');
        return t.replace(/\s{2,}/g, ' ').trim();
    }

    function splitTitleVariants(title) {
        const variants = [];
        const seen = new Set();
        const add = t => {
            const v = (t || '').trim();
            if (v && v.length > 1 && !seen.has(v.toLowerCase())) {
                seen.add(v.toLowerCase());
                variants.push(v);
            }
        };
        if (!title) return variants;
        add(title);
        const cleaned = cleanTitleForSearch(title);
        add(cleaned);
        [title, cleaned].forEach(t => {
            if (!t) return;
            t.split(/\s*[\/|]\s*/).forEach(part => add(part));
        });
        return variants;
    }

    function normalizeForCompare(s) {
        return (s || '')
            .toLowerCase()
            .replace(/[^a-z0-9а-яё]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function searchSteamGames(term) {
        return new Promise((resolve, reject) => {
            const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=russian&cc=ru`;
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                onload: function (response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const items = (data.items || []).map(item => ({
                            appid: item.id,
                            name: item.name,
                            url: `https://store.steampowered.com/app/${item.id}/`
                        }));
                        resolve(items);
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: reject
            });
        });
    }

    async function findSteamCandidates(title) {
        const variants = splitTitleVariants(title);
        for (const variant of variants) {
            try {
                const items = await searchSteamGames(variant);
                if (items.length) return items.slice(0, 8);
            } catch (e) {
                console.error('[GoFrag Auto] Ошибка поиска в Steam для варианта "' + variant + '":', e);
            }
        }
        return [];
    }

    function extractAppIdFromSteamUrl(steamUrl) {
        const m = (steamUrl || '').match(/\/app\/(\d+)/);
        return m ? m[1] : null;
    }

    function pickDefaultSteamMatch(title, candidates) {
        const variantsNorm = splitTitleVariants(title).map(normalizeForCompare);
        for (let i = 0; i < candidates.length; i++) {
            if (variantsNorm.includes(normalizeForCompare(candidates[i].name))) {
                return { index: i, url: candidates[i].url };
            }
        }
        return { index: -1, url: '' };
    }

    function fetchSteamCommunityScreenshots(appid, count = 6) {
        return new Promise((resolve) => {
            const url = `https://steamcommunity.com/app/${appid}/screenshots/?p=1&browsefilter=trendweek`;
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                resolve(result);
            };

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 8000,
                onload: function (response) {
                    try {
                        const html = response.responseText || '';
                        const patterns = [
                            /https:\/\/steamuserimages-a\.akamaihd\.net\/ugc\/[^\s"']+/g,
                            /https:\/\/images\.steamusercontent\.com\/ugc\/[^\s"']+/g,
                            /https:\/\/community\.cloudflare\.steamstatic\.com\/ugc\/[^\s"']+/g,
                            /https:\/\/community\.akamai\.steamstatic\.com\/ugc\/[^\s"']+/g
                        ];

                        let allMatches = [];
                        for (const pattern of patterns) {
                            const matches = html.match(pattern) || [];
                            allMatches = allMatches.concat(matches);
                        }

                        const uniqueUrls = [...new Set(allMatches)];
                        const imageUrls = uniqueUrls.filter(imageUrl =>
                            !imageUrl.includes('_thumb') &&
                            !imageUrl.includes('_preview') &&
                            !imageUrl.includes('_icon')
                        );

                        const seenContent = new Set();
                        const filteredUrls = [];
                        for (const imageUrl of imageUrls) {
                            const baseUrl = imageUrl.split('?')[0].replace(/\/\d+x\d+$/, '');
                            if (!seenContent.has(baseUrl)) {
                                seenContent.add(baseUrl);
                                filteredUrls.push(imageUrl);
                            }
                        }

                        async function checkScreenshots(urls) {
                            const validScreenshots = [];
                            for (const imageUrl of urls) {
                                if (validScreenshots.length >= count) break;
                                try {
                                    const result = await new Promise((resolveCheck) => {
                                        let checkSettled = false;
                                        const finishCheck = value => {
                                            if (checkSettled) return;
                                            checkSettled = true;
                                            resolveCheck(value);
                                        };
                                        GM_xmlhttpRequest({
                                            method: 'HEAD',
                                            url: imageUrl,
                                            timeout: 6000,
                                            onload: function (res) {
                                                try {
                                                    const contentLength = parseInt(res.responseHeaders.match(/Content-Length:\s*(\d+)/i)?.[1] || '0');
                                                    finishCheck(contentLength > 0 && contentLength < 10000 ? null : imageUrl);
                                                } catch (e) {
                                                    finishCheck(imageUrl);
                                                }
                                            },
                                            onerror: function () { finishCheck(imageUrl); },
                                            ontimeout: function () { finishCheck(imageUrl); }
                                        });
                                    });

                                    if (result) {
                                        const newBase = result.split('?')[0].replace(/\/\d+x\d+$/, '');
                                        const isDuplicate = validScreenshots.some(existing =>
                                            existing.split('?')[0].replace(/\/\d+x\d+$/, '') === newBase
                                        );
                                        if (!isDuplicate) validScreenshots.push(result);
                                    }
                                } catch (e) {
                                    console.warn('[GoFrag Auto] Ошибка проверки скриншота', e);
                                }
                            }
                            console.log('[GoFrag Auto] Скриншотов из Steam Community: ' + validScreenshots.length);
                            finish({ screenshots: validScreenshots, warning: '' });
                        }

                        checkScreenshots(filteredUrls).catch(error => {
                            console.error('[GoFrag Auto] Ошибка проверки скриншотов Steam Community:', error);
                            finish({
                                screenshots: [],
                                warning: 'Не удалось проверить дополнительные скриншоты Steam. Используются исходные изображения.'
                            });
                        });
                    } catch (e) {
                        console.error('[GoFrag Auto] Ошибка разбора скринов Steam Community:', e);
                        finish({
                            screenshots: [],
                            warning: 'Не удалось обработать скриншоты Steam. Используются исходные изображения.'
                        });
                    }
                },
                onerror: function () {
                    console.error('[GoFrag Auto] Не удалось получить скрины из Steam Community (сеть)');
                    finish({
                        screenshots: [],
                        warning: 'Steam не ответил при загрузке дополнительных скриншотов. Используются исходные изображения.'
                    });
                },
                ontimeout: function () {
                    console.warn('[GoFrag Auto] Тайм-аут загрузки скриншотов Steam Community');
                    finish({
                        screenshots: [],
                        warning: 'Steam не успел загрузить дополнительные скриншоты. Используются исходные изображения.'
                    });
                }
            });
        });
    }

    // Возвращает название найденной похожей игры или пустую строку.
    async function checkDuplicateOnGoFrag(gameTitle) {
        return new Promise((resolve) => {
            try {
                const searchUrl = `https://gofrag.ru/api/search?q=${encodeURIComponent(gameTitle)}&limit=20`;

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: searchUrl,
                    headers: {
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    onload: function (response) {
                        try {
                            if (response.status !== 200) {
                                resolve('');
                                return;
                            }

                            const data = JSON.parse(response.responseText);
                            const items = data.hits || data.items || data.results || data.data || [];

                            if (items.length === 0) {
                                resolve('');
                                return;
                            }

                            const normalizeName = (str) => {
                                if (!str) return '';
                                return str.toLowerCase()
                                    .replace(/[\(\)\[\]\{\}<>]/g, ' ')
                                    .replace(/[^\w\sа-яё]/gi, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                            };
                            const keepWord = w => w.length > 2 || /\d/.test(w);

                            const normalizedTitle = normalizeName(gameTitle);
                            const titleWords = normalizedTitle.split(' ').filter(keepWord);

                            for (const item of items) {
                                const rawTitle = item.title || item.name || '';
                                const itemTitle = normalizeName(rawTitle);
                                if (!itemTitle) continue;

                                if (itemTitle === normalizedTitle) {
                                    resolve(rawTitle);
                                    return;
                                }

                                if (itemTitle.includes(normalizedTitle) || normalizedTitle.includes(itemTitle)) {
                                    resolve(rawTitle);
                                    return;
                                }

                                if (titleWords.length > 1) {
                                    const itemWords = itemTitle.split(' ').filter(keepWord);
                                    const matchCount = titleWords.filter(w => itemWords.includes(w)).length;
                                    if (matchCount / titleWords.length >= 0.6) {
                                        resolve(rawTitle);
                                        return;
                                    }
                                }
                            }

                            resolve('');
                        } catch (e) {
                            console.error('[GoFrag Auto] Ошибка проверки дубликатов:', e);
                            resolve('');
                        }
                    },
                    onerror: function (error) {
                        console.error('[GoFrag Auto] Ошибка запроса:', error);
                        resolve('');
                    }
                });
            } catch (e) {
                console.error('[GoFrag Auto] Ошибка:', e);
                resolve('');
            }
        });
    }

    function showDialog(onSubmit, methodOptions, steamOptions, defaultGenre) {
        const { needsChoice = false, torrentAvailable = false, storageAvailable = false } = methodOptions || {};
        const { candidates: steamCandidates = [], defaultUrl: defaultSteamUrl = '', defaultIndex = -1 } = steamOptions || {};

        const overlay = document.createElement('div');
        overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;justify-content:center;align-items:center;`;

        const dialog = document.createElement('div');
        dialog.style.cssText = `background:#fff;padding:30px;border-radius:12px;max-width:500px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,.3);font-family:Arial,sans-serif;`;

        const methodBlockHtml = needsChoice ? `
            <div style="margin-bottom:20px;">
                <strong>Способ раздачи:</strong>
                <div style="display:flex;gap:16px;margin-top:6px;">
                    <label style="display:flex;align-items:center;gap:6px;font-weight:normal;">
                        <input type="radio" name="dl-method" value="torrent" checked> Торрент
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;font-weight:normal;">
                        <input type="radio" name="dl-method" value="archive"> Файловое хранилище (архив)
                    </label>
                </div>
            </div>
        ` : '';

        const steamCandidatesHtml = steamCandidates.length ? `
            <label style="display:block;margin-bottom:10px;">
                <strong>Найдено в Steam:</strong>
                <select id="steam-candidates" style="width:100%;padding:8px;margin-top:5px;border:1px solid #ccc;border-radius:4px;">
                    <option value="">— указать ссылку вручную —</option>
                    ${steamCandidates.map((c, i) => `<option value="${i}" ${i === defaultIndex ? 'selected' : ''}>${escapeHtml(c.name)} (appid ${c.appid})</option>`).join('')}
                </select>
            </label>
        ` : '';

        dialog.innerHTML = `
            <h2 style="margin-top:0;">🐾 Добавить на GoFrag</h2>
            ${steamCandidatesHtml}
            <label style="display:block;margin-bottom:10px;">
                <strong>Ссылка на Steam:</strong>
                <input type="text" id="steam-url" value="${defaultSteamUrl ? escapeHtml(defaultSteamUrl) : ''}" placeholder="https://store.steampowered.com/app/..." style="width:100%;padding:8px;margin-top:5px;border:1px solid #ccc;border-radius:4px;">
            </label>
            <label style="display:block;margin-bottom:20px;">
                <strong>Категория:</strong>
                <select id="genre-select" style="width:100%;padding:8px;margin-top:5px;border:1px solid #ccc;border-radius:4px;">
                    ${GENRES.map(g => `<option value="${g}" ${g === defaultGenre ? 'selected' : ''}>${g}</option>`).join('')}
                </select>
            </label>
            ${methodBlockHtml}
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button id="dialog-cancel" style="padding:8px 16px;background:#ccc;border:none;border-radius:4px;cursor:pointer;">Отмена</button>
                <button id="dialog-submit" style="padding:8px 16px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;">Добавить</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const candidateSelect = dialog.querySelector('#steam-candidates');
        if (candidateSelect) {
            candidateSelect.addEventListener('change', () => {
                const idx = candidateSelect.value;
                const urlInput = dialog.querySelector('#steam-url');
                if (idx !== '' && steamCandidates[idx]) {
                    urlInput.value = steamCandidates[idx].url;
                }
            });
        }

        dialog.querySelector('#dialog-cancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        dialog.querySelector('#dialog-submit').addEventListener('click', () => {
            const steamUrl = dialog.querySelector('#steam-url').value.trim();
            const genre = dialog.querySelector('#genre-select').value;
            if (!steamUrl) { alert('Введите ссылку на Steam!'); return; }

            let downloadMethod = torrentAvailable ? 'torrent' : (storageAvailable ? 'archive' : '');
            if (needsChoice) {
                const checked = dialog.querySelector('input[name="dl-method"]:checked');
                downloadMethod = checked ? checked.value : downloadMethod;
            }

            overlay.remove();
            const popup = window.open('', '_blank');
            onSubmit({ steamUrl, genre, downloadMethod }, popup);
        });
    }

    const byrutgameAdapter = (function () {
        const article = document.querySelector('article.main_content[data-news-id]');
        const newsId = article ? article.getAttribute('data-news-id') : null;
        const mainRelease = article ? article.querySelector('.main-release-block') : null;

        const ALLOWED_ARCHIVE_HOSTS = [
            'mediafire.com'
        ];
        const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024 * 1024;

        function getTitle() {
            const el = document.querySelector('h1[itemprop="name"]') || document.querySelector('h1');
            return el ? el.textContent.trim() : '';
        }

        function getVersion() {
            if (!mainRelease) return '';
            const infoBlock = mainRelease.querySelector('.info-basic') || mainRelease;
            const text = (infoBlock.innerText || infoBlock.textContent || '').trim();
            const match = text.match(/версия\s*\n?\s*([^\n]+)/i);
            if (match) return match[1].trim();
            return '';
        }

        function getTorrentUrl() {
            const links = document.querySelectorAll('a[href*="do=download"]');
            for (const a of links) {
                if (/\.torrent/i.test(a.textContent)) return a.href;
            }
            return '';
        }

        function findStorageBlock() {
            const blocks = document.querySelectorAll('#other_repacks .ajax-block[data-ajax]');
            for (const block of blocks) {
                const label = block.querySelector('.showtitle')?.textContent?.trim() || '';
                if (/файловое хранилище/i.test(label)) return block;
            }
            return null;
        }

        function parseSizeToBytes(sizeStr) {
            if (!sizeStr) return 0;
            const m = sizeStr.replace(',', '.').match(/([\d.]+)\s*(КБ|МБ|ГБ|ТБ|KB|MB|GB|TB)/i);
            if (!m) return 0;
            const num = parseFloat(m[1]);
            const unit = m[2].toUpperCase();
            const mult = {
                'КБ': 1024, 'KB': 1024,
                'МБ': 1024 ** 2, 'MB': 1024 ** 2,
                'ГБ': 1024 ** 3, 'GB': 1024 ** 3,
                'ТБ': 1024 ** 4, 'TB': 1024 ** 4
            }[unit] || 1;
            return num * mult;
        }

        function extractAllowedLinks(container) {
            const links = [];
            container.querySelectorAll('a[href]').forEach(a => {
                const href = a.getAttribute('href');
                if (!href) return;
                try {
                    const u = new URL(href, window.location.href);
                    u.hostname = u.hostname.toLowerCase();
                    const h = u.hostname.replace(/^www\./, '');
                    const allowed = ALLOWED_ARCHIVE_HOSTS.some(x => h === x || h.endsWith('.' + x));
                    if (allowed && !links.includes(u.href)) links.push(u.href);
                } catch (e) {}
            });
            return links;
        }

        async function ensureStorageContentLoaded(block, timeoutMs = 6000) {
            const hasLinks = el => !!(el && el.querySelector('a[href]'));
            let content = block.querySelector('.ajax-content');
            if (hasLinks(content)) return content;

            const trigger = block.querySelector('.ajax-trigger') || block.querySelector('.list_item') || block;
            trigger.click();

            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                content = block.querySelector('.ajax-content');
                if (hasLinks(content)) return content;
                await delay(200);
            }
            return content;
        }

        async function getStorageInfo() {
            const block = findStorageBlock();
            if (!block) return { links: [], sizeText: '', sizeBytes: 0, overLimit: false };

            const sizeText = block.querySelector('.dist_size')?.textContent?.trim() || '';
            const sizeBytes = parseSizeToBytes(sizeText);
            const overLimit = sizeBytes > 0 && sizeBytes > MAX_ARCHIVE_BYTES;

            let links = [];
            try {
                const content = await ensureStorageContentLoaded(block);
                if (content) links = extractAllowedLinks(content);
            } catch (e) {
                console.error('[GoFrag Auto][byrutgame] Ошибка при ожидании загрузки файлового хранилища:', e);
            }

            if (!links.length) {
                const dataAjax = block.getAttribute('data-ajax');
                try {
                    const html = await fetchAjaxBlock(dataAjax);
                    const container = document.createElement('div');
                    container.innerHTML = html;
                    links = extractAllowedLinks(container);
                } catch (e) {
                    console.error('[GoFrag Auto][byrutgame] Ошибка получения ссылок хранилища (AJAX):', e);
                }
            }

            return { links, sizeText, sizeBytes, overLimit };
        }

        function getScreenshots() {
            const urls = [];
            const scrblock = document.querySelector('.scrblock');
            if (scrblock) {
                scrblock.querySelectorAll('a.fresco').forEach(link => {
                    const href = link.getAttribute('href');
                    if (href && href.startsWith('http')) urls.push(href);
                });
            }
            return urls.slice(0, 6);
        }

        async function fetchAjaxBlock(block) {
            if (!block) throw new Error('У раздачи не найден AJAX-блок');
            if (!newsId) throw new Error('Не найден news id (data-news-id)');

            const formData = new FormData();
            formData.append('block', block);
            formData.append('id', newsId);

            const response = await fetch('/engine/ajax/controller.php?mod=ajaxsp', {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });

            if (!response.ok) throw new Error(`AJAX ${block}: HTTP ${response.status}`);
            return response.text();
        }

        async function collectDescription() {
            if (!mainRelease) return '';
            const allSpoilers = Array.from(
                mainRelease.querySelectorAll('details.spoiler[data-ajax^="mainfeatures"]')
            );

            const wantedSpoilers = allSpoilers.filter(spoiler => {
                const label = spoiler.querySelector('.i_spoiler')?.textContent || '';
                return /устано/i.test(label) || /dlc|длс|дополнени/i.test(label);
            });

            const sections = await Promise.all(wantedSpoilers.map(async spoiler => {
                const label = spoiler.querySelector('.i_spoiler')?.textContent?.trim();
                const block = spoiler.getAttribute('data-ajax');
                const content = await fetchAjaxBlock(block);
                const text = htmlToText(content);
                if (!text) return '';
                return label ? `${label}\n${text}` : text;
            }));

            return sections.filter(Boolean).join('\n\n');
        }

        function getGenreHint() {
            return null;
        }

        return { getTitle, getVersion, getTorrentUrl, getScreenshots, getStorageInfo, collectDescription, getGenreHint };
    })();

    const igrukhaAdapter = (function () {
        function getTitle() {
            const el = document.querySelector('#dle-content .module-title h1') || document.querySelector('h1');
            return el ? el.textContent.trim() : '';
        }

        function getVersion() {
            const exampleBlock = document.querySelector('.exampleone');
            if (exampleBlock) {
                const text = exampleBlock.textContent || '';
                const m = text.match(/до\s+версии\s+([^\.\)]+)/i);
                if (m) return m[1].trim();
            }
            const bodyText = document.body.innerText || '';
            const m2 = bodyText.match(/Размер:[^\n(]*\(([^)]+)\)/i);
            if (m2) return m2[1].trim();
            return '';
        }

        function getTorrentUrl() {
            const a = document.querySelector('a.torrent[href*="do=download"]');
            return a ? a.href : '';
        }

        function getScreenshots() {
            const urls = [];
            document.querySelectorAll('.item-screenstop a.highslide[href]').forEach(a => {
                const href = a.getAttribute('href');
                if (href && href.startsWith('http')) urls.push(href);
            });
            return urls.slice(0, 6);
        }

        function getGenreHint() {
            const bodyText = document.body.innerText || '';
            const m = bodyText.match(/Жанр:\s*([^\n]+)/i);
            if (!m) return null;
            const genresText = m[1].toLowerCase();
            for (const genre of GENRES) {
                if (genresText.includes(genre.toLowerCase())) return genre;
            }
            return null;
        }

        async function collectDescription() {
            const container = document.querySelector('#dle-content');
            if (!container) return '';
            const html = container.innerHTML;

            const parts = [];
            const install = extractLabeledHtmlSection(html, 'Установка');
            if (install) parts.push(`Установка:\n${install}`);

            const dlc = extractLabeledHtmlSection(html, 'DLC|Дополнени[а-я]*|длс');
            if (dlc) parts.push(`DLC:\n${dlc}`);

            return parts.join('\n\n');
        }

        async function getStorageInfo() {
            return { links: [], sizeText: '', sizeBytes: 0, overLimit: false };
        }

        return { getTitle, getVersion, getTorrentUrl, getScreenshots, getStorageInfo, collectDescription, getGenreHint };
    })();

    const SOURCE_ADAPTERS = {
        'byrutgame.org': byrutgameAdapter,
        'itorrents-igruha.org': igrukhaAdapter
    };

    function runSourceSite(adapter) {
        function addButton() {
            if (document.getElementById('gofrag-auto-btn')) return;

            const btn = document.createElement('button');
            btn.id = 'gofrag-auto-btn';
            btn.textContent = '🐾 Добавить на GoFrag';

            const isMobile = window.innerWidth < 768;

            btn.style.cssText = `
                position: fixed;
                bottom: ${isMobile ? '12px' : '20px'};
                right: ${isMobile ? '12px' : '20px'};
                padding: ${isMobile ? '14px 18px' : '12px 20px'};
                background: #4CAF50;
                color: #fff;
                border: none;
                border-radius: ${isMobile ? '50px' : '8px'};
                font-size: ${isMobile ? 'clamp(14px, 4vw, 18px)' : '16px'};
                font-weight: bold;
                cursor: pointer;
                z-index: 99999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                white-space: nowrap;
                touch-action: manipulation;
                transition: all 0.2s ease;
                min-height: ${isMobile ? '48px' : 'auto'};
                min-width: ${isMobile ? '48px' : 'auto'};
                letter-spacing: 0.5px;
                user-select: none;
                -webkit-tap-highlight-color: transparent;
            `;

            btn.addEventListener('touchstart', function () {
                this.style.transform = 'scale(0.95)';
                this.style.opacity = '0.85';
            }, { passive: true });

            btn.addEventListener('touchend', function () {
                this.style.transform = 'scale(1)';
                this.style.opacity = '1';
            }, { passive: true });

            btn.addEventListener('click', async function () {
                if (this.disabled) return;

                const title = adapter.getTitle();

                this.textContent = '🔍 Проверяю...';
                this.disabled = true;
                const similar = await checkDuplicateOnGoFrag(title);
                this.disabled = false;

                if (similar && !confirm('На GoFrag уже есть похожая игра: "' + similar + '". Всё равно добавить?')) {
                    this.textContent = '🐾 Добавить на GoFrag';
                    return;
                }

                this.textContent = '⏳ Сбор данных...';
                this.disabled = true;

                const version = adapter.getVersion();
                const screenshots = adapter.getScreenshots();
                const torrentUrl = adapter.getTorrentUrl();
                const sourceUrl = window.location.href;
                const genreHint = adapter.getGenreHint ? adapter.getGenreHint() : null;

                let description = '';
                let storage = { links: [], sizeText: '', sizeBytes: 0, overLimit: false };
                try {
                    description = await adapter.collectDescription();
                } catch (e) {
                    console.error('[GoFrag Auto] Ошибка сбора описания:', e);
                }
                try {
                    storage = await adapter.getStorageInfo();
                } catch (e) {
                    console.error('[GoFrag Auto] Ошибка сбора файлового хранилища:', e);
                }

                this.textContent = '🔎 Ищу в Steam...';
                let steamCandidates = [];
                try {
                    steamCandidates = await findSteamCandidates(title);
                } catch (e) {
                    console.error('[GoFrag Auto] Ошибка поиска в Steam:', e);
                }
                const { index: defaultIndex, url: defaultSteamUrl } = pickDefaultSteamMatch(title, steamCandidates);

                this.disabled = false;
                this.textContent = '🐾 Добавить на GoFrag';

                const torrentAvailable = !!torrentUrl;
                const storageAvailable = storage.links.length > 0 && !storage.overLimit;

                if (!torrentAvailable && !storageAvailable) {
                    alert('Не нашёл ни торрент, ни подходящее файловое хранилище для этой игры — раздачу придётся заполнить вручную на gofrag.');
                }

                const needsChoice = torrentAvailable && storageAvailable;

                showDialog(async ({ steamUrl, genre, downloadMethod }, popup) => {
                    let finalScreenshots = screenshots;
                    const parserWarnings = [];
                    const appId = extractAppIdFromSteamUrl(steamUrl);
                    if (appId) {
                        try {
                            const communityResult = await fetchSteamCommunityScreenshots(appId, 6);
                            const communityShots = communityResult.screenshots || [];
                            if (communityResult.warning) parserWarnings.push(communityResult.warning);
                            if (communityShots.length > 0) {
                                const combined = communityShots.slice();
                                for (const shot of screenshots) {
                                    if (combined.length >= 6) break;
                                    if (!combined.includes(shot)) combined.push(shot);
                                }
                                finalScreenshots = combined;
                            }
                        } catch (e) {
                            console.error('[GoFrag Auto] Ошибка получения скринов из Steam Community:', e);
                            parserWarnings.push('Не удалось получить дополнительные скриншоты Steam. Используются исходные изображения.');
                        }
                    }

                    if (!finalScreenshots.length) {
                        parserWarnings.push('Не найдено ни одного скриншота. Добавь изображения вручную.');
                    }

                    const payload = {
                        title, version, steamUrl, genre, screenshots: finalScreenshots, sourceUrl, description,
                        downloadMethod
                    };
                    if (downloadMethod === 'torrent') {
                        payload.torrentUrl = torrentUrl;
                    } else if (downloadMethod === 'archive') {
                        payload.archiveLinks = storage.links;
                        payload.archiveSizeText = storage.sizeText;
                        payload.description = `Репак версии ${version || 'неизвестна'}. Архив с игрой, распаковать и запустить. Без пароля.`;
                    }

                    payload.parserWarnings = parserWarnings;
                    GM_setValue('gofrag_parser_notice', '');
                    GM_setValue('gofrag_data', JSON.stringify(payload));
                    const targetUrl = 'https://gofrag.ru/component/com_gofrag_game_submit/';
                    if (popup && !popup.closed) {
                        popup.location.href = targetUrl;
                    } else {
                        window.open(targetUrl, '_blank');
                    }
                    btn.textContent = '✅ Отправлено!';
                    setTimeout(() => { btn.textContent = '🐾 Добавить на GoFrag'; }, 3000);
                }, { needsChoice, torrentAvailable, storageAvailable }, { candidates: steamCandidates, defaultUrl: defaultSteamUrl, defaultIndex }, genreHint);
            });

            document.body.appendChild(btn);
        }

        if (document.readyState === 'complete') {
            setTimeout(addButton, 500);
        } else {
            window.addEventListener('load', function () {
                setTimeout(addButton, 500);
            });
        }
    }

    if (SOURCE_HOSTS.includes(host)) {
        if (parserEnabled()) runSourceSite(SOURCE_ADAPTERS[host]);
        return;
    }

    function setFieldValue(field, value) {
        if (!field || value === undefined || value === null || value === '') return;
        const proto = field.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function setCategory(selectEl, genreName) {
        if (!selectEl) return;
        const id = CATEGORY_MAP[genreName];
        if (!id) return;
        selectEl.value = String(id);
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function downloadAsBlob(url) {
        return new Promise((resolve, reject) => {
            let referer;
            try { referer = new URL(url).origin + '/'; } catch (e) { referer = url; }
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                timeout: 15000,
                headers: { 'Referer': referer },
                onload: r => {
                    if (r.status >= 200 && r.status < 300) resolve(r);
                    else reject(new Error('HTTP ' + r.status));
                },
                onerror: reject,
                ontimeout: () => reject(new Error('Request timeout'))
            });
        });
    }

    function extractFilename(responseHeaders, fallback) {
        if (responseHeaders) {
            let m = responseHeaders.match(/filename\*=UTF-8''([^;\r\n]+)/i);
            if (m) { try { return decodeURIComponent(m[1].trim()); } catch (e) {} }
            m = responseHeaders.match(/filename="?([^";\r\n]+)"?/i);
            if (m) return m[1].trim();
        }
        return fallback;
    }

    async function setScreenshot(index, url) {
        const input = document.querySelector(`input[data-gfs-shot="${index}"]`);
        if (!input) { console.warn('[GoFrag Auto] Не найден input для скриншота', index); return false; }
        try {
            const r = await downloadAsBlob(url);
            const blob = r.response;
            let ext = 'jpg';
            if (blob.type.includes('png')) ext = 'png';
            else if (blob.type.includes('webp')) ext = 'webp';
            const file = new File([blob], `screenshot_${index}.${ext}`, { type: blob.type || 'image/jpeg' });
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch (e) {
            console.error('[GoFrag Auto] Ошибка загрузки скриншота', index, url, e);
            return false;
        }
    }

    async function setTorrentFile(url, titleFallback) {
        const input = document.querySelector('input[data-gfs-torrent]');
        if (!input) { console.warn('[GoFrag Auto] Не найден input для .torrent'); return false; }

        if (url.includes('itorrents-igruha.org')) {
            alert('Торрент-Игруха запрещает скачивание через скрипт. Скачай торрент-файл вручную и прикрепи его на этой странице.');
            return false;
        }

        try {
            const r = await downloadAsBlob(url);
            const blob = r.response;

            const contentType = (r.responseHeaders || '').match(/Content-Type:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase() || '';
            let firstBytes = '';
            try {
                const slice = blob.slice(0, 100);
                firstBytes = await slice.text();
            } catch (e) {}

            const looksLikeHtml = contentType.includes('text/html') ||
                                  firstBytes.trim().startsWith('<!DOCTYPE') ||
                                  firstBytes.trim().startsWith('<html') ||
                                  firstBytes.trim().startsWith('<?xml');

            if (looksLikeHtml) {
                console.error('[GoFrag Auto] Получена HTML-страница вместо торрента.');
                alert('Не удалось скачать .torrent. Прикрепи торрент-файл вручную.');
                return false;
            }

            const fallbackName = (titleFallback || 'game').replace(/[^\w\d]+/g, '_') + '.torrent';
            const filename = extractFilename(r.responseHeaders, fallbackName);
            const file = new File([blob], filename, { type: blob.type || 'application/x-bittorrent' });
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch (e) {
            console.error('[GoFrag Auto] Ошибка загрузки торрента:', url, e);
            alert('Не удалось скачать .torrent. Прикрепи торрент-файл вручную.');
            return false;
        }
    }

    function waitFor(selector, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const found = document.querySelector(selector);
            if (found) return resolve(found);
            const start = Date.now();
            const iv = setInterval(() => {
                const el = document.querySelector(selector);
                if (el) { clearInterval(iv); resolve(el); }
                else if (Date.now() - start > timeoutMs) { clearInterval(iv); reject(new Error('timeout waiting for ' + selector)); }
            }, 200);
        });
    }

    async function fillForm() {
        const raw = GM_getValue('gofrag_data');
        if (!raw) return;
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            console.error('[GoFrag Auto] Не удалось прочитать данные парсера:', e);
            GM_setValue('gofrag_parser_notice', JSON.stringify(['Не удалось прочитать переданные данные. Проверь заполнение формы вручную.']));
            return;
        }

        const parserWarnings = Array.isArray(data.parserWarnings) ? data.parserWarnings.slice() : [];
        try {
            await waitFor('input[data-gfs-field="title"]');

            setFieldValue(document.querySelector('input[data-gfs-field="title"]'), data.title);
            setFieldValue(document.querySelector('input[data-gfs-field="steam_url"]'), data.steamUrl);
            setFieldValue(document.querySelector('input[data-gfs-field="version"]'), data.version);
            setCategory(document.querySelector('select[data-gfs-field="category_id"]'), data.genre);
            setFieldValue(document.querySelector('input[data-gfs-field="source_url"]'), data.sourceUrl);
            setFieldValue(document.querySelector('textarea[data-gfs-field="repack_description"]'), data.description);

            if (data.screenshots && data.screenshots.length) {
                let uploadedScreenshots = 0;
                for (let i = 0; i < data.screenshots.length && i < 6; i++) {
                    const uploaded = await setScreenshot(i + 1, data.screenshots[i]);
                    if (uploaded) uploadedScreenshots++;
                    else parserWarnings.push(`Не удалось загрузить скриншот №${i + 1}. Добавь его вручную.`);
                    await delay(400);
                }
                if (uploadedScreenshots === 0) {
                    parserWarnings.push('Ни один скриншот не загрузился автоматически.');
                }
            }

            if (data.downloadMethod === 'torrent' && data.torrentUrl) {
                const torrentUploaded = await setTorrentFile(data.torrentUrl, data.title);
                if (!torrentUploaded) parserWarnings.push('Торрент-файл не прикрепился автоматически. Добавь .torrent вручную.');
            } else if (data.downloadMethod === 'archive' && data.archiveLinks && data.archiveLinks.length) {
                const archiveField = document.querySelector('textarea[data-gfs-archive-links]');
                if (archiveField) {
                    setFieldValue(archiveField, data.archiveLinks.join('\n'));
                    setFieldValue(document.querySelector('input[data-gfs-field="archive_size_human"]'), data.archiveSizeText);
                } else {
                    parserWarnings.push('Не найдено поле для ссылок на архив. Заполни его вручную.');
                }
            }

            GM_setValue('gofrag_data', '');
            GM_setValue('gofrag_parser_notice', parserWarnings.length ? JSON.stringify([...new Set(parserWarnings)]) : '');
            console.log('[GoFrag Auto] Форма заполнена. Проверь поля и добавь раздачу вручную.');
        } catch (e) {
            console.error('[GoFrag Auto] Ошибка заполнения формы:', e);
            parserWarnings.push('Не удалось полностью заполнить форму. Проверь поля и файлы вручную.');
            GM_setValue('gofrag_parser_notice', JSON.stringify([...new Set(parserWarnings)]));
            GM_setValue('gofrag_data', '');
        }
    }

    fillForm();
})();

(function () {
    'use strict';

    if (location.hostname !== 'gofrag.ru') return;

    const I18N = {
        en: {
            nav_home: 'Home', nav_window: 'Window', nav_theme: 'Theme', nav_gamepage: 'Game Page', nav_cat: 'Cat', nav_extras: 'Extras',
            welcome: 'Welcome,', tg: 'Join TG channel', gh: 'Source code on GitHub',
            winopts: 'Window options', opacity: 'Opacity', nomove: 'No move', noresize: 'No resize', startup_toast: 'Startup toast', sidebar_btn: 'Show "gf.util" button',
            watermark: 'Watermark', wm_enabled: 'Enabled', wm_corner: 'Corner', corner_tl: 'Top left', corner_tr: 'Top right', corner_bl: 'Bottom left', corner_br: 'Bottom right',
            wm_user: 'Username', wm_time: 'Date & time', wm_fps: 'FPS counter',
            hotkey: 'Hotkey', key: 'Key', press_any: 'Press any key...',
            anim: 'Animation', anim_type: 'Type', anim_none: 'None (instant)', anim_fade: 'Fade', anim_slideL: 'Slide from left', anim_slideR: 'Slide from right', anim_slideU: 'Slide from top', anim_slideD: 'Slide from bottom', anim_zoom: 'Zoom', anim_zoomUp: 'Zoom + rise', anim_pop: 'Pop (bouncy)',
            duration: 'Duration', preview: 'Preview',
            tint: 'Colors (tint)', tint_lab: 'Tint', amount: 'Amount',
            bg: 'Background', bg_url_ph: 'Image URL', browse: 'Browse...', blur: 'Blur', dim: 'Dim', clear: 'Clear',
            font: 'Font', family: 'Family', font_default: 'Default (Nunito)', font_system: 'System UI', font_serif: 'Serif (Georgia)',
            cursor: 'Cursor changer', cursor_mode: 'Mode', cursor_default: 'Default', cursor_dot: 'Dot', cursor_cross: 'Crosshair', cursor_circle: 'Circle', cursor_arrow: 'Arrow', cursor_color: 'Color', cursor_smooth: 'Smoothness', cursor_size: 'Size', cursor_width: 'Width', cursor_alpha: 'Opacity', cursor_anim: 'Animation',
            reset_theme: 'Reset theme',
            tools: 'Tools', random: 'Random gradient', io: 'Export / Import', io_ph: 'Settings JSON', export: 'Export', import: 'Import', reset_all: 'Reset all',
            comments: 'Comments', show_loadall: 'Show "Load all" button', enter_submit: 'Submit on Enter',
            more_emoji: 'More emoji in the picker', emoji_extra: 'More emoji', emo_face: 'Faces', emo_hand: 'Hands', emo_animal: 'Animals', emo_food: 'Food', emo_thing: 'Things', emo_symbol: 'Symbols',
            nav_parser: 'Auto-parser', parser: 'Game parser', parser_enabled: 'Show "Add to GoFrag" button on source sites', parser_hint: 'Open a source site and go to a game page: the button appears in the bottom right corner.', parser_sites: 'Sources', parser_byrut: 'Open ByRut', parser_igruha: 'Open Torrent-Igruha', parser_note: 'Torrent files from Torrent-Igruha must be attached manually: the site blocks script downloads.',
            feeder: 'Cat feeder', autofeed: 'Auto feed on page load', feednow: 'Feed now',
            devourer: 'Devourer cat',
            changer: 'Cat changer', breed: 'Breed', stage: 'Stage', variant: 'VI appearance', breed_auto: 'Auto (site default)', breed_classic: 'Classic', breed_ginger: 'Ginger', breed_siamese: 'Siamese', breed_mainecoon: 'Maine coon', breed_bengal: 'Bengal', breed_neva: 'Neva', breed_black: 'Black', stage_auto: 'Auto (current)', variant_auto: 'Auto (A)', vi_a: 'A', vi_b: 'B', vi_c: 'C', reset: 'Reset',
            toast_loaded: 'Script loaded successfully', toast_open: 'Press {KEY} to open the menu',
            feeding: 'Feeding...', fed_today: 'Already fed today', fed_limit: 'Already fed / limit reached',
            fed_ok: 'Fed! +{INCOME} fish · balance {BAL} · streak {STREAK}', fed_new_stage: ' · new stage!',
            fed_dev: 'Fed! +{INCOME} fish · balance {BAL} · left today {LEFT}',
            failed: 'Failed: ', unknown_err: 'unknown error', csrf_err: 'CSRF token not found',
            cat_fed: 'The cat has been fed: +{INCOME} fish', cat_bal: 'Balance: {BAL} · streak: {STREAK}',
            dev_fed: 'The devourer has been fed: +{INCOME} fish', dev_unlock: ' · reward unlocked!', dev_bal: 'Balance: {BAL} · left today: {LEFT}',
            autofeed_fail: 'Auto feed failed', io_fail: 'Import failed: invalid JSON',
            confirm_reset: 'Reset all script settings?'
        },
        ru: {
            nav_home: 'Главная', nav_window: 'Окно', nav_theme: 'Тема', nav_gamepage: 'Стр. игры', nav_cat: 'Кот', nav_extras: 'Разное',
            welcome: 'Привет,', tg: 'Telegram-канал', gh: 'Исходники на GitHub',
            winopts: 'Параметры окна', opacity: 'Прозрачность', nomove: 'Не двигать', noresize: 'Не растягивать', startup_toast: 'Стартовый тост', sidebar_btn: 'Кнопка «gf.util»',
            watermark: 'Ватермарка', wm_enabled: 'Включена', wm_corner: 'Угол', corner_tl: 'Левый верх', corner_tr: 'Правый верх', corner_bl: 'Левый низ', corner_br: 'Правый низ',
            wm_user: 'Ник', wm_time: 'Дата и время', wm_fps: 'Счётчик FPS',
            hotkey: 'Хоткей', key: 'Клавиша', press_any: 'Нажмите клавишу...',
            anim: 'Анимация', anim_type: 'Тип', anim_none: 'Нет (мгновенно)', anim_fade: 'Затухание', anim_slideL: 'Выезд слева', anim_slideR: 'Выезд справа', anim_slideU: 'Выезд сверху', anim_slideD: 'Выезд снизу', anim_zoom: 'Зум', anim_zoomUp: 'Зум + подъём', anim_pop: 'Поп (пружинка)',
            duration: 'Длительность', preview: 'Превью',
            tint: 'Цвета (тинт)', tint_lab: 'Тинт', amount: 'Сила',
            bg: 'Фон', bg_url_ph: 'Ссылка на картинку', browse: 'Файл...', blur: 'Блюр', dim: 'Затемнение', clear: 'Убрать',
            font: 'Шрифт', family: 'Гарнитура', font_default: 'Сайт (Nunito)', font_system: 'Системный', font_serif: 'Serif (Georgia)',
            cursor: 'Смена курсора', cursor_mode: 'Режим', cursor_default: 'Обычный', cursor_dot: 'Точка', cursor_cross: 'Перекрестие', cursor_circle: 'Кружок', cursor_arrow: 'Стрелка', cursor_color: 'Цвет', cursor_smooth: 'Плавность', cursor_size: 'Размер', cursor_width: 'Толщина', cursor_alpha: 'Прозрачность', cursor_anim: 'Анимация',
            reset_theme: 'Сбросить тему',
            tools: 'Инструменты', random: 'Случайный градиент', io: 'Экспорт / Импорт', io_ph: 'JSON настроек', export: 'Экспорт', import: 'Импорт', reset_all: 'Сбросить всё',
            comments: 'Комментарии', show_loadall: 'Кнопка «Загрузить все»', enter_submit: 'Отправка по Enter',
            more_emoji: 'Больше эмодзи в панели', emoji_extra: 'Ещё эмодзи', emo_face: 'Лица', emo_hand: 'Руки', emo_animal: 'Животные', emo_food: 'Еда', emo_thing: 'Вещи', emo_symbol: 'Символы',
            nav_parser: 'Автопарсинг', parser: 'Парсер игр', parser_enabled: 'Кнопка «Добавить на GoFrag» на сайтах-источниках', parser_hint: 'Открой сайт-источник и зайди на страницу игры: справа внизу появится кнопка «Добавить на GoFrag».', parser_sites: 'Источники', parser_byrut: 'Открыть ByRut', parser_igruha: 'Открыть Торрент-Игруху', parser_note: 'С Торрент-Игрухи торрент-файл нужно прикреплять вручную: сайт запрещает скачивание скриптом.',
            feeder: 'Кормление кота', autofeed: 'Автокорм при загрузке', feednow: 'Покормить',
            devourer: 'Кот-поглотитель',
            changer: 'Смена кота', breed: 'Порода', stage: 'Стадия', variant: 'Вариант VI стадии', breed_auto: 'Авто (как на сайте)', breed_classic: 'Классический', breed_ginger: 'Рыжий', breed_siamese: 'Сиамский', breed_mainecoon: 'Мейн-кун', breed_bengal: 'Бенгальский', breed_neva: 'Невская маскарадная', breed_black: 'Чёрный', stage_auto: 'Авто (текущая)', variant_auto: 'Авто (A)', vi_a: 'A', vi_b: 'B', vi_c: 'C', reset: 'Сброс',
            toast_loaded: 'Скрипт успешно загружен', toast_open: 'Нажмите {KEY}, чтобы открыть меню',
            feeding: 'Кормлю...', fed_today: 'Сегодня уже кормлен', fed_limit: 'Уже кормлен / лимит',
            fed_ok: 'Покормлен! +{INCOME} рыб · баланс {BAL} · стрик {STREAK}', fed_new_stage: ' · новая стадия!',
            fed_dev: 'Покормлен! +{INCOME} рыб · баланс {BAL} · осталось сегодня {LEFT}',
            failed: 'Ошибка: ', unknown_err: 'неизвестная ошибка', csrf_err: 'CSRF-токен не найден',
            cat_fed: 'Кот покормлен: +{INCOME} рыб', cat_bal: 'Баланс: {BAL} · стрик: {STREAK}',
            dev_fed: 'Поглотитель покормлен: +{INCOME} рыб', dev_unlock: ' · награда открыта!', dev_bal: 'Баланс: {BAL} · осталось сегодня: {LEFT}',
            autofeed_fail: 'Автокорм не удался', io_fail: 'Импорт не удался: некорректный JSON',
            confirm_reset: 'Сбросить все настройки скрипта?'
        }
    };
    function t(k) { return (I18N[settings.general.lang] && I18N[settings.general.lang][k]) || I18N.en[k] || k; }
    function tf(k, vars) { let s = t(k); for (const v in vars) s = s.split('{' + v + '}').join(vars[v]); return s; }

    const EGG_USERS = [
        { slug: 'pianino2', label: 'Фембойчик :3', nameMatch: 'pianino', bg: '#f472b6' },
        { slug: 'daniil5x', label: 'ЗЛО', nameMatch: 'daniil', bg: '#fdba74' }
    ];
    const EGG_SKIP = '#gf-menu, #gf-toasts, #gf-watermark, .gf-bw, .gfk-own';

    function eggify(el, user) {
        if (!el || el.dataset.gfEgg) return;
        el.dataset.gfEgg = '1';
        el.textContent = user.label;
        el.className = 'gfk-tbadge gf-egg-badge';
        el.style.setProperty('--egg-bg', user.bg);
        el.removeAttribute('title');
    }

    function eggUserForLink(link) {
        const href = (link.getAttribute('href') || '').toLowerCase();
        const txt = (link.textContent || '').trim().toLowerCase();
        for (const u of EGG_USERS) {
            if (href.indexOf('/cat/' + u.slug) !== -1 && txt.includes(u.nameMatch)) return u;
        }
        return null;
    }

    function applyEggBadges() {
        const path = location.pathname.toLowerCase();
        for (const u of EGG_USERS) {
            if (path.indexOf('/cat/' + u.slug) === 0) {
                eggify(document.querySelector('.gfk-top__badges .gfk-tbadge'), u);
                break;
            }
        }
        document.querySelectorAll('.gf-badge, .gfk-tbadge').forEach(b => {
            if (b.dataset.gfEgg || b.classList.contains('gf-egg-badge')) return;
            if (b.closest(EGG_SKIP)) return;
            const scope = b.parentElement;
            if (!scope) return;
            for (const link of scope.querySelectorAll('a[href*="/cat/"]')) {
                const u = eggUserForLink(link);
                if (u) { eggify(b, u); break; }
            }
        });
    }

    const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
    let konamiPos = 0;
    let fakePremod = null;
    let openMenuHook = null;

    function toggleFakePremod() {
        if (fakePremod && fakePremod.isConnected) {
            fakePremod.remove();
            fakePremod = null;
            showToast({ title: 'wow', line1: 'LOL', life: 3200 });
            return;
        }
        const guild = document.querySelector('.gf-fc2__guild');
        if (!guild) return;
        const a = document.createElement('a');
        a.className = 'gf-fc2__glink gf-fc2__glink--premod';
        a.href = '#';
        const badge = 1 + Math.floor(Math.random() * 99);
        a.innerHTML = '<span class="gf-fc2__glink-em">&#128221;</span><span class="gf-fc2__glink-label">Премодерация</span><span class="gf-fc2__premod-badge">' + badge + '</span>';
        a.addEventListener('click', e => {
            e.preventDefault();
            showToast({ title: 'Premoderation', line1: 'This one is fake :3', life: 3200 });
        });
        const anchor = guild.querySelector('.gf-fc2__glink--chat');
        if (anchor) guild.insertBefore(a, anchor);
        else guild.appendChild(a);
        fakePremod = a;
        showToast({ title: 'gf.util', line1: ':-)', line2: 'A fake premoderation tab has appeared', life: 3600 });
    }

    function injectSidebarButton() {
        if (!settings.window.sidebarButton) return;
        const guild = document.querySelector('.gf-fc2__guild');
        if (!guild || guild.querySelector('.gf-sidebar-btn')) return;
        const a = document.createElement('a');
        a.className = 'gf-fc2__glink gf-sidebar-btn';
        a.href = '#';
        a.innerHTML = '<span class="gf-fc2__glink-label">gf.util</span>';
        a.addEventListener('click', e => {
            e.preventDefault();
            if (openMenuHook) openMenuHook();
        });
        guild.appendChild(a);
    }

    function removeSidebarButton() {
        document.querySelectorAll('.gf-sidebar-btn').forEach(b => b.remove());
    }

    function syncSidebarButton() {
        if (settings.window.sidebarButton) injectSidebarButton();
        else removeSidebarButton();
    }

    const DEFAULTS = {
        general: { lang: 'en' },
        window: {
            opacity: 94, noMove: false, noResize: false, anim: 'zoom', animDuration: 180,
            hotkey: 'ShiftRight', showStartupToast: true, sidebarButton: false,
            watermark: true, watermarkUser: true, watermarkTime: false, watermarkFps: false,
            watermarkCorner: 'tl'
        },
        gamepage: { commentsLoadAll: false, enterSubmit: false, moreEmoji: false },
        parser: { enabled: true },
        cat: { autoFeed: false, autoFeedDevourer: false, breed: 'auto', stage: 'auto', variant: 'auto' },
        theme: {
            tintColor1: '#4296fa', tintColor2: '#3169bd', tintAmount: 0,
            bgImage: '', bgBlur: 0, bgDim: 40,
            font: { family: 'default' },
            cursor: { mode: 'default', color: '#ffffff', smooth: 60, size: 12, width: 2, alpha: 100, anim: true }
        }
    };

    function deepMerge(base, over) {
        const out = Object.assign({}, base);
        for (const k in over) {
            if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k]) out[k] = deepMerge(base[k], over[k]);
            else out[k] = over[k];
        }
        return out;
    }

    let settings = deepMerge(DEFAULTS, GM_getValue('gf_theme_v4', {}));
    function save() { GM_setValue('gf_theme_v4', settings); }

    function ensureStyleTag(id) {
        let tag = document.getElementById(id);
        if (!tag) { tag = document.createElement('style'); tag.id = id; document.head.appendChild(tag); }
        return tag;
    }

    let tintLayer = null;
    function ensureTintLayer() {
        if (tintLayer) return tintLayer;
        tintLayer = document.createElement('div'); tintLayer.id = 'gf-tint-layer';
        document.documentElement.appendChild(tintLayer); return tintLayer;
    }
    function applyTint() {
        const layer = ensureTintLayer(); const amt = settings.theme.tintAmount;
        if (amt <= 0) { layer.style.display = 'none'; return; }
        layer.style.display = 'block';
        layer.style.background = `linear-gradient(135deg, ${settings.theme.tintColor1}, ${settings.theme.tintColor2})`;
        layer.style.opacity = (amt / 100).toFixed(2);
    }

    let bgLayer = null, bgDimEl = null;
    function ensureBgLayer() {
        if (bgLayer) return bgLayer;
        bgLayer = document.createElement('div'); bgLayer.id = 'gf-bg-layer';
        bgDimEl = document.createElement('div'); bgDimEl.id = 'gf-bg-dim';
        bgLayer.appendChild(bgDimEl); document.documentElement.appendChild(bgLayer); return bgLayer;
    }

    function applyBg() {
        const hasImg = !!settings.theme.bgImage;
        const layer = ensureBgLayer();
        layer.style.display = hasImg ? 'block' : 'none';
        if (hasImg) {
            layer.style.backgroundImage = `url("${settings.theme.bgImage}")`;
            layer.style.filter = `blur(${settings.theme.bgBlur}px)`;
        }
        bgDimEl.style.background = `rgba(0,0,0,${settings.theme.bgDim / 100})`;

        document.querySelectorAll(
            'header, .tm-header, .tm-header-mobile, .uk-navbar-container, .uk-navbar, header .uk-container, ' +
            '.gf-precontent, .gf-precontent .uk-panel, .gfc-head, .gfc-body, .gfc-grid, ' +
            '.gf-fc2__qcell'
        ).forEach(el => {
            if (hasImg) {
                el.style.setProperty('background', 'transparent', 'important');
                el.style.setProperty('background-image', 'none', 'important');
            } else {
                el.style.removeProperty('background');
                el.style.removeProperty('background-image');
            }
        });

        const tag = ensureStyleTag('gf-bg-transparency');
        tag.textContent = hasImg ? `
            html, body, #tm-main, .tm-page,
            .uk-section-default, .uk-section-muted, #tm-bottom {
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
            }
            header, .tm-header, .tm-header-mobile,
            .tm-header .uk-navbar-container, .tm-header-mobile .uk-navbar-container,
            .tm-header .uk-navbar, .tm-header-mobile .uk-navbar,
            .tm-header .uk-container, .tm-header-mobile .uk-container {
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
            }
            header::before, header::after,
            .tm-header::before, .tm-header::after,
            .tm-header-mobile::before, .tm-header-mobile::after,
            header .uk-navbar-container::before, header .uk-navbar-container::after,
            header .uk-navbar::before, header .uk-navbar::after {
                display: none !important;
                background: transparent !important;
                background-image: none !important;
            }
            .gf-precontent, .gf-precontent .uk-panel, .gfc-head, .gfc-body, .gfc-grid {
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
            }
            .gf-precontent::before, .gf-precontent::after,
            .gfc-head::before, .gfc-head::after {
                display: none !important;
                background: transparent !important;
                background-image: none !important;
            }
            .gf-fc2__qcell {
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
            }
            .gf-fc2__qcell:hover { background: rgba(255,255,255,.07) !important; }
            #tm-main .uk-grid-stack .uk-panel,
            #tm-main .gf-fc2, #tm-main .gf-fc2__id,
            #tm-main .gf-fc2__guild, #tm-main .gf-fc2__guild-main,
            #tm-main .gf-fc2__guild-head, #tm-main .gf-fc2__rooms,
            #tm-main .gf-gmm, #tm-main .gf-gmm-head, #tm-main .gf-gmm-section {
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
            }
        ` : '';
    }

    const FONT_MAP = {
        default: null,
        system: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
        roboto: `'Roboto', sans-serif`,
        montserrat: `'Montserrat', sans-serif`,
        mono: `'JetBrains Mono', Consolas, monospace`,
        serif: `Georgia, 'Times New Roman', serif`,
        comic: `'Comic Neue', 'Comic Sans MS', cursive`
    };
    const GOOGLE_FONT_URL = { roboto: 'Roboto:wght@400;600;700', montserrat: 'Montserrat:wght@400;600;700', mono: 'JetBrains+Mono:wght@400;600', comic: 'Comic+Neue:wght@400;700' };
    const loadedFonts = new Set();
    function ensureGoogleFont(key) {
        if (!GOOGLE_FONT_URL[key] || loadedFonts.has(key)) return;
        const l = document.createElement('link'); l.rel = 'stylesheet';
        l.href = `https://fonts.googleapis.com/css2?family=${GOOGLE_FONT_URL[key]}&display=swap`;
        document.head.appendChild(l); loadedFonts.add(key);
    }
    function applyFont() {
        const tag = ensureStyleTag('gf-font-style');
        const key = settings.theme.font.family; const fam = FONT_MAP[key];
        if (key !== 'default') ensureGoogleFont(key);
        tag.textContent = fam ? `
            html, body, p, span, div, a, li, td, th, button, input, textarea, label,
            h1, h2, h3, h4, h5, h6, .uk-nav-default, .uk-navbar-nav > li > a, .gf-tag, .gfk-top__name, .gfk-btn {
                font-family: ${fam} !important;
            }
            [class*="icon-"], [class^="icon-"], .uk-icon, [class*="uk-icon-"] { font-family: IcoMoon !important; }
        ` : '';
    }

    let curEl = null, curRaf = null;
    let curX = 0, curY = 0, targetX = 0, targetY = 0;
    const CURSOR_CUSTOM = ['dot', 'cross', 'circle', 'arrow'];
    let cursorLoopLast = 0;

    function cursorStyleTag() { return ensureStyleTag('gf-cursor-style'); }

    function buildCursorVisual(mode) {
        const c = settings.theme.cursor;
        const s = c.size;
        const w = c.width;
        const col = c.color;
        switch (mode) {
            case 'dot':
                return `<div style="position:absolute;left:50%;top:50%;width:${s}px;height:${s}px;margin:${-s / 2}px 0 0 ${-s / 2}px;border-radius:50%;background:${col};box-shadow:0 0 6px rgba(0,0,0,.55)"></div>`;
            case 'cross':
                return `<div style="position:absolute;left:50%;top:50%;width:${s * 2}px;height:${s * 2}px;margin:${-s}px 0 0 ${-s}px">
                    <div style="position:absolute;left:50%;top:0;bottom:0;width:${w}px;margin-left:${-w / 2}px;background:${col}"></div>
                    <div style="position:absolute;top:50%;left:0;right:0;height:${w}px;margin-top:${-w / 2}px;background:${col}"></div>
                </div>`;
            case 'circle':
                return `<div style="position:absolute;left:50%;top:50%;width:${s * 2.2}px;height:${s * 2.2}px;margin:${-s * 1.1}px 0 0 ${-s * 1.1}px;border-radius:50%;border:${w}px solid ${col};box-sizing:border-box"></div>
                    <div style="position:absolute;left:50%;top:50%;width:${w + 1}px;height:${w + 1}px;margin:${-(w + 1) / 2}px 0 0 ${-(w + 1) / 2}px;border-radius:50%;background:${col}"></div>`;
            case 'arrow':
                return `<div style="position:absolute;left:50%;top:50%;width:0;height:0;margin:-1px 0 0 -1px;border-top:${s * 1.2}px solid ${col};border-right:${s * 0.8}px solid transparent;transform:rotate(-8deg);filter:drop-shadow(0 0 3px rgba(0,0,0,.5))"></div>`;
        }
        return '';
    }

    function applyCursor() {
        const mode = settings.theme.cursor.mode;
        const style = cursorStyleTag();

        if (mode === 'default' || !CURSOR_CUSTOM.includes(mode)) {
            style.textContent = '';
            if (curEl) { curEl.remove(); curEl = null; }
            if (curRaf) { cancelAnimationFrame(curRaf); curRaf = null; }
            return;
        }

        style.textContent = `* { cursor: none !important; }`;

        if (!curEl) {
            curEl = document.createElement('div');
            curEl.id = 'gf-cursor';
            const inner = document.createElement('div');
            inner.id = 'gf-cursor-inner';
            curEl.appendChild(inner);
            document.body.appendChild(curEl);
            curX = targetX; curY = targetY;
        }

        const inner = curEl.querySelector('#gf-cursor-inner');
        inner.innerHTML = buildCursorVisual(mode);
        curEl.style.opacity = String(settings.theme.cursor.alpha / 100);
        startCursorLoop();
    }

    function startCursorLoop() {
        if (curRaf) return;
        cursorLoopLast = performance.now();
        const step = (now) => {
            const smooth = settings.theme.cursor.smooth;
            let k;
            if (smooth <= 0) k = 1;
            else {
                const dt = Math.min(64, now - cursorLoopLast);
                cursorLoopLast = now;
                k = 1 - Math.pow(0.05, (dt / 16.66) / (smooth / 60));
                k = Math.min(1, Math.max(0.1, k));
            }
            curX += (targetX - curX) * k;
            curY += (targetY - curY) * k;
            if (Math.abs(targetX - curX) < 0.1) curX = targetX;
            if (Math.abs(targetY - curY) < 0.1) curY = targetY;
            curEl.style.transform = `translate3d(${curX}px, ${curY}px, 0)`;
            curRaf = requestAnimationFrame(step);
        };
        curRaf = requestAnimationFrame(step);
    }

    document.addEventListener('mousemove', e => {
        targetX = e.clientX; targetY = e.clientY;
    }, true);

    document.addEventListener('mousedown', () => {
        if (!curEl || !settings.theme.cursor.anim) return;
        const inner = curEl.querySelector('#gf-cursor-inner');
        if (!inner) return;
        inner.classList.remove('gf-pop');
        void inner.offsetWidth;
        inner.classList.add('gf-pop');
    }, true);

    function applyAll() { applyTint(); applyBg(); applyFont(); applyCursor(); }

    function findSubmitButton(scope) {
        if (!scope) return null;
        const sels = [
            'button.gfc-submit', 'button.gf-cm-submit', 'button[type="submit"]', 'input[type="submit"]',
            'button[class*="submit"]', 'a[class*="submit"]'
        ];
        for (const sel of sels) {
            const btn = scope.querySelector(sel);
            if (btn) return btn;
        }
        for (const b of scope.querySelectorAll('button')) {
            const txt = (b.textContent || '').trim().toLowerCase();
            if (txt === 'отправить' || txt === 'submit' || txt === 'send') return b;
        }
        return null;
    }

    function submitCommentField(el) {
        let scope = el.parentElement;
        for (let i = 0; i < 6 && scope; i++) {
            const btn = findSubmitButton(scope);
            if (btn) { btn.click(); return true; }
            if (scope.tagName && scope.tagName.toLowerCase() === 'form') break;
            scope = scope.parentElement;
        }
        const form = el.closest('form');
        if (form) {
            const btn = form.querySelector('button[type="submit"], input[type="submit"]');
            if (btn) { btn.click(); return true; }
            if (form.requestSubmit) { form.requestSubmit(); return true; }
        }
        return false;
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
        if (!settings.gamepage.enterSubmit) return;
        const el = e.target;
        const tag = (el.tagName || '').toLowerCase();
        if (tag !== 'textarea' && tag !== 'input') return;
        if (el.isContentEditable) return;
        if (tag === 'textarea' && !(el.value || '').trim()) return;
        if (el.closest('#gf-menu')) return;
        if (el.closest('.gf-search')) return;
        if (submitCommentField(el)) e.preventDefault();
    }, true);

    const IM_IDENT = { o: 1, x: 0, y: 0, s: 1 };
    const ANIM_TYPES = {
        none: null,
        fade:   { pose: { o: 0, x: 0,   y: 0,   s: 1 } },
        slideL: { pose: { o: 0, x: -80, y: 0,   s: 1 } },
        slideR: { pose: { o: 0, x: 80,  y: 0,   s: 1 } },
        slideU: { pose: { o: 0, x: 0,   y: -80, s: 1 } },
        slideD: { pose: { o: 0, x: 0,   y: 80,  s: 1 } },
        zoom:   { pose: { o: 0, x: 0,   y: 0,   s: 0.82 } },
        zoomUp: { pose: { o: 0, x: 0,   y: 28,  s: 0.92 } },
        pop:    { pose: { o: 0, x: 0, y: 0, s: 0.55 }, hidePose: { o: 0, x: 0, y: 0, s: 0.7 }, back: true }
    };
    const easeOutCubic = tt => 1 - Math.pow(1 - tt, 3);
    const easeInCubic = tt => tt * tt * tt;
    const easeOutBack = tt => { const c = 1.70158; return 1 + (c + 1) * Math.pow(tt - 1, 3) + c * Math.pow(tt - 1, 2); };
    let stopMenuAnimHook = null;

    function keyDisplayName(code) {
        if (!code) return 'None';
        const map = {
            ShiftRight: 'RShift', ShiftLeft: 'LShift',
            ControlRight: 'RCtrl', ControlLeft: 'LCtrl',
            AltRight: 'RAlt', AltLeft: 'LAlt',
            MetaLeft: 'LWin', MetaRight: 'RWin',
            Space: 'Space', Enter: 'Enter', Tab: 'Tab', CapsLock: 'CapsLk', Backspace: 'Bksp',
            Backquote: '`', Minus: '-', Equal: '=',
            BracketLeft: '[', BracketRight: ']', Backslash: '\\',
            Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
            Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
            PageUp: 'PgUp', PageDown: 'PgDn',
            ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
            NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *',
            NumpadDivide: 'Num /', NumpadEnter: 'Num Enter', NumpadDecimal: 'Num .'
        };
        if (map[code]) return map[code];
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        if (/^F\d{1,2}$/.test(code)) return code;
        if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
        return code;
    }

    function getCurrentUsername() {
        const el = document.querySelector('.gf-auth-username');
        if (el && el.textContent.trim()) return el.textContent.trim();
        try {
            const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (w.gfsConfig && w.gfsConfig.profileSlug) return w.gfsConfig.profileSlug;
        } catch (e) {}
        return 'user';
    }

    function getPanelPos(panel) {
        const x = parseFloat(panel.style.left), y = parseFloat(panel.style.top);
        return { x: isNaN(x) ? 90 : x, y: isNaN(y) ? 90 : y };
    }

    GM_addStyle(`
        #gf-tint-layer { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; mix-blend-mode: color; display: none; }
        #gf-bg-layer { position: fixed; inset: -20px; z-index: -1; background-size: cover; background-position: center; transform: scale(1.06); display: none; }
        #gf-bg-dim { position: absolute; inset: -20px; }
        #gf-cursor {
            position: fixed; left: 0; top: 0; z-index: 9999999999;
            pointer-events: none; width: 0; height: 0; will-change: transform;
        }
        #gf-cursor-inner { width: 0; height: 0; }
        #gf-cursor-inner.gf-pop { animation: gf-cursor-pop 160ms ease-out; }
        @keyframes gf-cursor-pop {
            0% { transform: scale(1); }
            35% { transform: scale(1.9); }
            65% { transform: scale(0.55); }
            100% { transform: scale(1); }
        }
        #gf-menu {
            --im-text: #e6e6e6; --im-textdis: #999999; --im-border: rgba(110,110,110,0.25);
            --im-frame: #292929; --im-frameh: #323232; --im-framea: #454545;
            --im-btn: rgba(66,150,250,0.40); --im-btnh: rgba(66,150,250,0.85); --im-btna: rgb(15,135,250);
            --im-header: rgba(66,150,250,0.31); --im-headerh: rgba(66,150,250,0.80);
            --im-grab: #3d85e0; --im-graba: #599cf2;
            position: fixed; top: 90px; left: 90px; width: 470px; max-height: 86vh;
            background: rgba(15,15,15,var(--gf-op,0.94)); border: 1px solid var(--im-border);
            color: var(--im-text); font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 13px; line-height: 1.4; display: none; flex-direction: column;
            z-index: 2147483647; user-select: none;
        }
        #gf-menu.gf-visible { display: flex; }
        #gf-menu.collapsed { width: auto !important; height: auto !important; max-height: none !important; }
        #gf-menu.collapsed #gf-main, #gf-menu.collapsed #gf-grip { display: none !important; }
        #gf-menu.collapsed #gf-titletext { flex: 0 0 auto; padding-right: 4px; }
        #gf-menu :is(input, textarea, select, button, a):focus,
        #gf-menu :is(input, textarea, select, button, a):focus-visible {
            outline: none !important;
            outline-color: transparent !important;
            box-shadow: none !important;
            border-color: transparent !important;
        }
        #gf-title { background: #292929; display: flex; align-items: center; height: 25px; padding: 0 3px 0 1px; cursor: move; flex-shrink: 0; }
        .gf-titlebtn { background: none; border: none; color: rgba(230,230,230,0.75); width: 21px; height: 21px; font: 13px/21px 'Segoe UI', sans-serif; cursor: pointer; padding: 0; }
        .gf-titlebtn:hover { color: #fff; background: var(--im-headerh); }
        #gf-titletext { flex: 1; padding-left: 5px; white-space: nowrap; }
        #gf-main { display: flex; flex: 1; min-height: 0; }
        #gf-nav { width: 148px; flex-shrink: 0; border-right: 1px solid var(--im-border); overflow-y: auto; padding: 3px 0; }
        .gf-nav-item { padding: 3px 10px; cursor: pointer; }
        .gf-nav-item:hover { background: var(--im-headerh); }
        .gf-nav-item.sel { background: var(--im-header); }
        #gf-content { flex: 1; min-width: 0; overflow-y: auto; padding: 5px 8px 16px; }
        .gf-pane { display: none; }
        .gf-pane.sel { display: block; }
        .gf-tree { margin-bottom: 3px; }
        .gf-tree-head { display: flex; align-items: center; gap: 5px; padding: 2px 3px; cursor: pointer; }
        .gf-tree-head:hover { background: var(--im-headerh); }
        .gf-tree-arrow { display: inline-block; width: 11px; font-size: 9px; color: rgba(230,230,230,0.65); text-align: center; }
        .gf-tree.open > .gf-tree-head .gf-tree-arrow { transform: rotate(90deg); }
        .gf-tree-body { display: none; padding: 3px 0 5px 18px; }
        .gf-tree.open > .gf-tree-body { display: block; }
        .gf-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .gf-lab { flex-shrink: 0; }
        .gf-slider-wrap { position: relative; height: 19px; flex: 1; min-width: 50px; background: var(--im-frame); }
        .gf-slider-wrap:hover { background: var(--im-frameh); }
        #gf-menu .gf-slider-wrap input[type=range] { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; opacity: 0 !important; cursor: pointer; }
        .gf-slider-grab { position: absolute; top: 2px; bottom: 2px; width: 12px; background: var(--im-grab); pointer-events: none; }
        .gf-slider-wrap:active .gf-slider-grab { background: var(--im-graba); }
        .gf-slider-val { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; font-size: 12px; text-shadow: 0 1px 1px rgba(0,0,0,0.55); }
        .gf-check { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; cursor: pointer; }
        #gf-menu .gf-check input { appearance: none !important; -webkit-appearance: none !important; width: 19px !important; height: 19px !important; min-width: 19px !important; max-width: 19px !important; min-height: 19px !important; max-height: 19px !important; margin: 0 !important; padding: 0 !important; border: none !important; background: var(--im-frame) !important; position: relative; cursor: pointer; flex-shrink: 0; box-sizing: border-box; }
        #gf-menu .gf-check input:hover { background: var(--im-frameh) !important; }
        #gf-menu .gf-check input:active { background: var(--im-framea) !important; }
        #gf-menu .gf-check input:checked { background: var(--im-framea) !important; }
        #gf-menu .gf-check input:checked::after { content: ''; position: absolute; left: 5px; top: 3px; width: 5px; height: 8px; border: solid rgba(230,230,230,0.7); border-width: 0 2px 2px 0; transform: rotate(40deg); }
        .gf-btn { background: var(--im-btn); border: none; color: var(--im-text); font: inherit; padding: 3px 12px; cursor: pointer; box-sizing: border-box; }
        .gf-btn:hover { background: var(--im-btnh); }
        .gf-btn:active { background: var(--im-btna); }
        #gf-menu .gf-btn.listening { background: var(--im-btna) !important; color: #fff !important; }
        #gf-menu .gf-input, #gf-menu .gf-editor { background: var(--im-frame); border: none; color: var(--im-text); font: inherit; padding: 3px 6px; box-sizing: border-box; min-height: 0; min-width: 0; }
        #gf-menu .gf-input:hover, #gf-menu .gf-editor:hover { background: var(--im-frameh); }
        #gf-menu .gf-input:focus, #gf-menu .gf-editor:focus { background: var(--im-framea) !important; }
        .gf-editor { width: 100%; min-height: 110px; resize: vertical; font-family: Consolas, 'Courier New', monospace; font-size: 12px; line-height: 1.45; }
        .gf-swatches { display: flex; gap: 3px; flex: 0 0 auto; }
        .gf-swatch { position: relative; width: 19px; height: 19px; flex: 0 0 19px; box-sizing: border-box; overflow: hidden; border: 1px solid rgba(0,0,0,0.5); background: var(--im-frame); cursor: pointer; }
        .gf-swatch:hover { outline: 1px solid rgba(230,230,230,0.35); outline-offset: -1px; }
        #gf-menu .gf-swatch input[type=color] { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important; border: none !important; opacity: 0 !important; cursor: pointer; }
        .gf-selectwrap { position: relative; flex: 1; min-width: 0; }
        #gf-menu .gf-select { appearance: none; -webkit-appearance: none; width: 100%; background: var(--im-frame); border: none; color: var(--im-text); font: inherit; padding: 3px 22px 3px 6px; cursor: pointer; box-sizing: border-box; }
        .gf-select:hover { background: var(--im-frameh); }
        .gf-selectwrap::after { content: ''; position: absolute; right: 7px; top: 50%; margin-top: -2px; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid rgba(230,230,230,0.55); pointer-events: none; }
        #gf-grip { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; clip-path: polygon(100% 0, 100% 100%, 0 100%); background: repeating-linear-gradient(135deg, rgba(66,150,250,0.35) 0 1px, transparent 1px 4px); }
        #gf-grip:hover { background: repeating-linear-gradient(135deg, rgba(66,150,250,0.75) 0 1px, transparent 1px 4px); }
        #gf-menu ::-webkit-scrollbar { width: 14px; height: 14px; }
        #gf-menu ::-webkit-scrollbar-track { background: rgba(5,5,5,0.53); }
        #gf-menu ::-webkit-scrollbar-thumb { background: #4f4f4f; border-radius: 6px; border: 3px solid transparent; background-clip: content-box; }
        #gf-menu ::-webkit-scrollbar-thumb:hover { background-color: #696969; }
        #gf-menu ::-webkit-scrollbar-corner { background: transparent; }
        #gf-toasts { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column-reverse; gap: 8px; z-index: 2147483645; pointer-events: none; }
        .gf-toast { pointer-events: auto; width: 262px; background: rgba(15,15,15,0.94); border: 1px solid rgba(110,110,110,0.25); color: #e6e6e6; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 13px; line-height: 1.4; user-select: none; cursor: pointer; display: none; flex-direction: column; }
        .gf-toast-title { background: #292929; padding: 4px 8px; font-size: 12px; color: #d4d4d4; display: flex; justify-content: space-between; align-items: center; }
        .gf-toast-x { color: rgba(230,230,230,0.6); padding: 0 3px; font-size: 11px; }
        .gf-toast-x:hover { color: #fff; }
        .gf-toast-body { padding: 8px 10px 9px; }
        .gf-toast-line2 { color: #999; font-size: 12px; margin-top: 2px; }
        .gf-toast-bar { height: 4px; background: #292929; margin: 0 10px 9px; position: relative; }
        .gf-toast-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: linear-gradient(180deg, #4296fa, #3169bd); }
        .gf-feed-status { color: #999; font-size: 11.5px; line-height: 1.5; margin-top: 4px; word-break: break-word; }
        .gf-home-hello { font-size: 15px; font-weight: 600; color: #e6e6e6; margin: 4px 0 2px; }
        .gf-home-hello b { color: #4296fa; }
        .gf-home-ver { color: #999; font-size: 11.5px; margin-bottom: 0; }
        .gf-home-btn { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; text-align: left; background: var(--im-btn); border: none; color: var(--im-text); font: inherit; padding: 5px 12px; cursor: pointer; margin-bottom: 6px; text-decoration: none; }
        .gf-home-btn:hover { background: var(--im-btnh); color: var(--im-text) !important; }
        .gf-home-btn:active { background: var(--im-btna); color: var(--im-text) !important; }
        .gf-home-btn .gf-home-arrow { margin-left: auto; color: rgba(230,230,230,0.55); }
        .gf-home-toprow { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
        .gf-lang-switch { display: flex; gap: 4px; flex-shrink: 0; }
        .gf-lang-btn { width: 26px; height: 17px; padding: 0; border: 1px solid rgba(0,0,0,0.5); cursor: pointer; box-sizing: border-box; flex-shrink: 0; }
        .gf-lang-btn:hover { filter: brightness(1.25); }
        .gf-lang-btn.active { box-shadow: 0 0 0 1px rgba(255,255,255,.85); }
        .gf-flag-ru {
            background: linear-gradient(to bottom,
                #ffffff 0 33.4%,
                #0039a6 33.4% 66.7%,
                #d52b1e 66.7% 100%);
        }
        .gf-flag-us {
            background-image:
                radial-gradient(circle, #ffffff 50%, transparent 55%),
                radial-gradient(circle, #ffffff 50%, transparent 55%),
                radial-gradient(circle, #ffffff 50%, transparent 55%),
                radial-gradient(circle, #ffffff 50%, transparent 55%),
                linear-gradient(#3c3b6e, #3c3b6e),
                repeating-linear-gradient(to bottom, #b22234 0, #b22234 1.15px, #ffffff 1.15px, #ffffff 2.3px);
            background-size: 1.6px 1.6px, 1.6px 1.6px, 1.6px 1.6px, 1.6px 1.6px, 42% 46%, 100% 100%;
            background-position: 2px 2px, 5px 2px, 8px 2px, 5px 5px, 0 0, 0 0;
            background-repeat: no-repeat;
        }
        #gf-watermark {
            position: fixed; z-index: 2147483646;
            pointer-events: none; user-select: none;
            background: rgba(15,15,15,0.94); border: 1px solid rgba(110,110,110,0.25);
            color: #e6e6e6; font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px; line-height: 1; padding: 5px 9px; white-space: nowrap;
        }
        .gf-load-more-wrap .gf-load-all { margin-left: 8px; opacity: .92; }
        .gf-egg-badge {
            display: inline-flex; align-items: center;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .8px;
            text-transform: uppercase;
            padding: 3px 9px;
            border-radius: 4px;
            line-height: 1.7;
            color: #0b0d10 !important;
            background: var(--egg-bg, #f472b6) !important;
            white-space: nowrap; user-select: none;
        }
        .gf-sidebar-btn .gf-fc2__glink-label { color: #4296fa !important; }
        .gf-sidebar-btn:hover .gf-fc2__glink-label { color: #6ab4ff !important; }
    `);

    function tree(id, title, bodyHtml) { return `<div class="gf-tree open" data-tree="${id}"><div class="gf-tree-head"><span class="gf-tree-arrow">&#9656;</span>${title}</div><div class="gf-tree-body">${bodyHtml}</div></div>`; }
    function sliderRow(id, label, min, max, value, suffix) { return `<div class="gf-row"><div class="gf-slider-wrap"><input type="range" id="${id}" min="${min}" max="${max}" value="${value}"><div class="gf-slider-grab" id="${id}-grab"></div><span class="gf-slider-val" id="${id}-lbl">${value}${suffix}</span></div><span class="gf-lab">${label}</span></div>`; }
    function checkRow(id, label, checked) { return `<label class="gf-check"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}><span>${label}</span></label>`; }

    function buildMenu() {
        const menu = document.createElement('div'); menu.id = 'gf-menu';
        menu.innerHTML = `
            <div id="gf-title">
                <button class="gf-titlebtn" id="gf-collapse" title="Collapse">&#8722;</button>
                <span id="gf-titletext">gf.util</span>
                <button class="gf-titlebtn" id="gf-close" title="Close">&#10005;</button>
            </div>
            <div id="gf-main"><div id="gf-nav">
                <div class="gf-nav-item sel" data-pane="home">${t('nav_home')}</div>
                <div class="gf-nav-item" data-pane="window">${t('nav_window')}</div>
                <div class="gf-nav-item" data-pane="theme">${t('nav_theme')}</div>
                <div class="gf-nav-item" data-pane="gamepage">${t('nav_gamepage')}</div>
                <div class="gf-nav-item" data-pane="cat">${t('nav_cat')}</div>
                <div class="gf-nav-item" data-pane="parser">${t('nav_parser')}</div>
                <div class="gf-nav-item" data-pane="extras">${t('nav_extras')}</div>
            </div><div id="gf-content">
                <div class="gf-pane sel" data-pane="home">
                    <div class="gf-home-toprow">
                        <div>
                            <div class="gf-home-hello">${t('welcome')} <b>${getCurrentUsername()}</b></div>
                            <div class="gf-home-ver">gf.util v${(typeof GM_info !== 'undefined' && GM_info.script.version) || '0.4.0'}</div>
                        </div>
                        <div class="gf-lang-switch">
                            <button type="button" class="gf-lang-btn gf-flag-ru${settings.general.lang === 'ru' ? ' active' : ''}" data-lang="ru" title="Русский"></button>
                            <button type="button" class="gf-lang-btn gf-flag-us${settings.general.lang === 'en' ? ' active' : ''}" data-lang="en" title="English"></button>
                        </div>
                    </div>
                    <a class="gf-home-btn" href="https://t.me/gf_util" target="_blank" rel="noopener noreferrer">${t('tg')} <span class="gf-home-arrow">&#8599;</span></a>
                    <a class="gf-home-btn" href="https://github.com/nunemusegan-bot/gf-util-v2" target="_blank" rel="noopener noreferrer">${t('gh')} <span class="gf-home-arrow">&#8599;</span></a>
                </div>
                <div class="gf-pane" data-pane="window">
                    ${tree('winopts', t('winopts'), `${sliderRow('gf-op', t('opacity'), 40, 100, settings.window.opacity, '%')}${checkRow('gf-nomove', t('nomove'), settings.window.noMove)}${checkRow('gf-noresize', t('noresize'), settings.window.noResize)}${checkRow('gf-toast-toggle', t('startup_toast'), settings.window.showStartupToast)}${checkRow('gf-sidebar-toggle', t('sidebar_btn'), settings.window.sidebarButton)}`)}
                    ${tree('watermark', t('watermark'), `
                        ${checkRow('gf-wm-on', t('wm_enabled'), settings.window.watermark)}
                        <div class="gf-row"><div class="gf-selectwrap"><select class="gf-select" id="gf-wm-corner">
                            <option value="tl">${t('corner_tl')}</option>
                            <option value="tr">${t('corner_tr')}</option>
                            <option value="bl">${t('corner_bl')}</option>
                            <option value="br">${t('corner_br')}</option>
                        </select></div><span class="gf-lab">${t('wm_corner')}</span></div>
                        ${checkRow('gf-wm-user', t('wm_user'), settings.window.watermarkUser)}
                        ${checkRow('gf-wm-time', t('wm_time'), settings.window.watermarkTime)}
                        ${checkRow('gf-wm-fps', t('wm_fps'), settings.window.watermarkFps)}
                    `)}
                    ${tree('hotkey', t('hotkey'), `<div class="gf-row"><button class="gf-btn" id="gf-hotkey-btn" style="flex:1">${keyDisplayName(settings.window.hotkey)}</button><span class="gf-lab">${t('key')}</span></div>`)}
                    ${tree('anim', t('anim'), `<div class="gf-row"><div class="gf-selectwrap"><select class="gf-select" id="gf-anim"><option value="none">${t('anim_none')}</option><option value="fade">${t('anim_fade')}</option><option value="slideL">${t('anim_slideL')}</option><option value="slideR">${t('anim_slideR')}</option><option value="slideU">${t('anim_slideU')}</option><option value="slideD">${t('anim_slideD')}</option><option value="zoom">${t('anim_zoom')}</option><option value="zoomUp">${t('anim_zoomUp')}</option><option value="pop">${t('anim_pop')}</option></select></div><span class="gf-lab">${t('anim_type')}</span></div>${sliderRow('gf-animdur', t('duration'), 60, 500, settings.window.animDuration, 'ms')}<div class="gf-row"><button class="gf-btn" id="gf-animpreview">${t('preview')}</button></div>`)}
                </div>
                <div class="gf-pane" data-pane="theme">
                    ${tree('tint', t('tint'), `<div class="gf-row"><div class="gf-swatches"><div class="gf-swatch" id="gf-sw1"><input type="color" id="gf-c1" value="${settings.theme.tintColor1}"></div><div class="gf-swatch" id="gf-sw2"><input type="color" id="gf-c2" value="${settings.theme.tintColor2}"></div></div><span class="gf-lab">${t('tint_lab')}</span></div>${sliderRow('gf-amt', t('amount'), 0, 100, settings.theme.tintAmount, '%')}`)}
                    ${tree('bg', t('bg'), `<div class="gf-row"><input type="text" class="gf-input" id="gf-bgurl" style="flex:1" placeholder="${t('bg_url_ph')}" value="${settings.theme.bgImage.startsWith('data:') ? '' : settings.theme.bgImage}"><button class="gf-btn" id="gf-browse">${t('browse')}</button><input type="file" id="gf-bgfile" accept="image/*" style="display:none"></div>${sliderRow('gf-blur', t('blur'), 0, 40, settings.theme.bgBlur, 'px')}${sliderRow('gf-dim', t('dim'), 0, 90, settings.theme.bgDim, '%')}<div class="gf-row" style="margin-top:2px"><button class="gf-btn" id="gf-bgclear">${t('clear')}</button></div>`)}
                    ${tree('font', t('font'), `<div class="gf-row"><div class="gf-selectwrap"><select class="gf-select" id="gf-font"><option value="default">${t('font_default')}</option><option value="system">${t('font_system')}</option><option value="roboto">Roboto</option><option value="montserrat">Montserrat</option><option value="mono">JetBrains Mono</option><option value="serif">${t('font_serif')}</option><option value="comic">Comic Neue</option></select></div><span class="gf-lab">${t('family')}</span></div>`)}
                    ${tree('cursor', t('cursor'), `
                        <div class="gf-row"><div class="gf-selectwrap"><select class="gf-select" id="gf-curmode">
                            <option value="default">${t('cursor_default')}</option>
                            <option value="dot">${t('cursor_dot')}</option>
                            <option value="cross">${t('cursor_cross')}</option>
                            <option value="circle">${t('cursor_circle')}</option>
                            <option value="arrow">${t('cursor_arrow')}</option>
                        </select></div><span class="gf-lab">${t('cursor_mode')}</span></div>
                        <div class="gf-row"><div class="gf-swatches"><div class="gf-swatch" id="gf-swcur"><input type="color" id="gf-cursor-color" value="${settings.theme.cursor.color}"></div></div><span class="gf-lab">${t('cursor_color')}</span></div>
                        ${sliderRow('gf-cursor-smooth', t('cursor_smooth'), 0, 150, settings.theme.cursor.smooth, 'ms')}
                        ${sliderRow('gf-cursor-size', t('cursor_size'), 6, 24, settings.theme.cursor.size, 'px')}
                        ${sliderRow('gf-cursor-width', t('cursor_width'), 1, 6, settings.theme.cursor.width, 'px')}
                        ${sliderRow('gf-cursor-alpha', t('cursor_alpha'), 10, 100, settings.theme.cursor.alpha, '%')}
                        ${checkRow('gf-cursor-anim', t('cursor_anim'), settings.theme.cursor.anim)}
                    `)}
                    <div class="gf-row" style="margin-top:8px"><button class="gf-btn" id="gf-reset-theme">${t('reset_theme')}</button></div>
                </div>
                <div class="gf-pane" data-pane="gamepage">
                    ${tree('gpcomments', t('comments'), `${checkRow('gf-gp-loadall', t('show_loadall'), settings.gamepage.commentsLoadAll)}${checkRow('gf-entersubmit', t('enter_submit'), settings.gamepage.enterSubmit)}`)}
                    ${tree('gpemoji', t('emoji_extra'), checkRow('gf-more-emoji', t('more_emoji'), settings.gamepage.moreEmoji))}
                </div>
                <div class="gf-pane" data-pane="cat">
                    ${tree('feeder', t('feeder'), `${checkRow('gf-autofeed', t('autofeed'), settings.cat.autoFeed)}<div class="gf-row"><button class="gf-btn" id="gf-feednow">${t('feednow')}</button></div><div class="gf-feed-status" id="gf-feed-status"></div>`)}
                    ${tree('devourer', t('devourer'), `${checkRow('gf-autofeed-dev', t('autofeed'), settings.cat.autoFeedDevourer)}<div class="gf-row"><button class="gf-btn" id="gf-feednow-dev">${t('feednow')}</button></div><div class="gf-feed-status" id="gf-feed-status-dev"></div>`)}
                    ${tree('changer', t('changer'), `
                        <div class="gf-row"><div class="gf-selectwrap"><select class="gf-select" id="gf-catbreed">
                            <option value="auto">${t('breed_auto')}</option>
                            <option value="classic">${t('breed_classic')}</option>
                            <option value="ginger">${t('breed_ginger')}</option>
                            <option value="siamese">${t('breed_siamese')}</option>
                            <option value="mainecoon">${t('breed_mainecoon')}</option>
                            <option value="bengal">${t('breed_bengal')}</option>
                            <option value="neva">${t('breed_neva')}</option>
                            <option value="black">${t('breed_black')}</option>
                        </select></div><span class="gf-lab">${t('breed')}</span></div>
                        <div class="gf-row"><div class="gf-selectwrap"><select class="gf-select" id="gf-catstage">
                            <option value="auto">${t('stage_auto')}</option>
                            <option value="0">I</option>
                            <option value="1">II</option>
                            <option value="2">III</option>
                            <option value="3">IV</option>
                            <option value="4">V</option>
                            <option value="5">VI</option>
                        </select></div><span class="gf-lab">${t('stage')}</span></div>
                        <div class="gf-row"><div class="gf-selectwrap"><select class="gf-select" id="gf-catvariant">
                            <option value="auto">${t('variant_auto')}</option>
                            <option value="a">${t('vi_a')}</option>
                            <option value="b">${t('vi_b')}</option>
                            <option value="c">${t('vi_c')}</option>
                        </select></div><span class="gf-lab">${t('variant')}</span></div>
                        <div class="gf-row"><button class="gf-btn" id="gf-catreset">${t('reset')}</button></div>
                    `)}
                </div>
                <div class="gf-pane" data-pane="parser">
                    ${tree('parser', t('parser'), `${checkRow('gf-parser-on', t('parser_enabled'), settings.parser.enabled)}<div class="gf-feed-status">${t('parser_hint')}</div>`)}
                    ${tree('parsersites', t('parser_sites'), `
                        <a class="gf-home-btn" href="https://byrutgame.org/" target="_blank" rel="noopener noreferrer">${t('parser_byrut')} <span class="gf-home-arrow">&#8599;</span></a>
                        <a class="gf-home-btn" href="https://itorrents-igruha.org/" target="_blank" rel="noopener noreferrer">${t('parser_igruha')} <span class="gf-home-arrow">&#8599;</span></a>
                        <div class="gf-feed-status">${t('parser_note')}</div>
                    `)}
                </div>
                <div class="gf-pane" data-pane="extras">
                    ${tree('tools', t('tools'), `<div class="gf-row"><button class="gf-btn" id="gf-random">${t('random')}</button></div>`)}
                    ${tree('io', t('io'), `<textarea class="gf-editor" id="gf-io" spellcheck="false" placeholder="${t('io_ph')}"></textarea><div class="gf-row" style="margin-top:6px"><button class="gf-btn" id="gf-export">${t('export')}</button><button class="gf-btn" id="gf-import">${t('import')}</button></div>`)}
                    <div class="gf-row" style="margin-top:8px"><button class="gf-btn" id="gf-reset-all">${t('reset_all')}</button></div>
                </div>
            </div></div><div id="gf-grip"></div>`;
        document.body.appendChild(menu); return menu;
    }

    function showToast({ title = 'gf.util', line1 = '', line2 = '', life = 4200, onClick = null } = {}) {
        let wrap = document.getElementById('gf-toasts');
        if (!wrap) { wrap = document.createElement('div'); wrap.id = 'gf-toasts'; document.body.appendChild(wrap); }
        const el = document.createElement('div');
        el.className = 'gf-toast';
        el.innerHTML = `
            <div class="gf-toast-title"><span>${title}</span><span class="gf-toast-x">&#10005;</span></div>
            <div class="gf-toast-body">
                <div>${line1}</div>
                ${line2 ? `<div class="gf-toast-line2">${line2}</div>` : ''}
            </div>
            <div class="gf-toast-bar"><div class="gf-toast-bar-fill"></div></div>`;
        wrap.appendChild(el);

        const IN_DUR = 180, OUT_DUR = 220, SLIDE = 60;
        const fill = el.querySelector('.gf-toast-bar-fill');
        const t0 = performance.now();
        let raf = null, done = false, poseO = 0, poseX = SLIDE;

        function render() { el.style.opacity = String(poseO); el.style.transform = `translateX(${poseX}px)`; }
        function close() {
            if (done) return; done = true;
            if (raf) cancelAnimationFrame(raf);
            const s = performance.now(), o0 = poseO, x0 = poseX;
            const stepOut = (now) => {
                const k = Math.min(1, (now - s) / OUT_DUR);
                const e = k * k;
                poseO = o0 * (1 - e); poseX = x0 + SLIDE * e;
                render();
                if (k < 1) requestAnimationFrame(stepOut); else el.remove();
            };
            requestAnimationFrame(stepOut);
        }
        el.addEventListener('click', () => { if (onClick) onClick(); close(); });
        el.style.display = 'flex';
        const step = (now) => {
            if (done) return;
            const dt = now - t0;
            if (dt <= IN_DUR) {
                const e = 1 - Math.pow(1 - dt / IN_DUR, 3);
                poseO = e; poseX = SLIDE * (1 - e);
            } else {
                poseO = 1; poseX = 0;
                fill.style.width = (Math.max(0, 1 - (dt - IN_DUR) / (life - IN_DUR)) * 100).toFixed(2) + '%';
            }
            render();
            if (dt >= life) { close(); return; }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
    }

    function showStartupToast() {
        if (!settings.window.showStartupToast) return;
        showToast({
            title: 'gf.util',
            line1: t('toast_loaded'),
            line2: tf('toast_open', { KEY: keyDisplayName(settings.window.hotkey) }),
            onClick: () => { if (openMenuHook) openMenuHook(); }
        });
    }

    function showParserNoticeWhenReady() {
        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            const rawNotice = GM_getValue('gofrag_parser_notice', '');
            if (rawNotice) {
                clearInterval(timer);
                GM_setValue('gofrag_parser_notice', '');
                let warnings = [];
                try {
                    const parsed = JSON.parse(rawNotice);
                    warnings = Array.isArray(parsed) ? parsed : [String(parsed)];
                } catch (e) {
                    warnings = [String(rawNotice)];
                }
                showToast({
                    title: 'Автопарсер GoFrag',
                    line1: 'Не всё удалось загрузить автоматически',
                    line2: warnings.join(' · '),
                    life: 9000
                });
            } else if (attempts >= 360) {
                clearInterval(timer);
            }
        }, 500);
    }

    let wmEl = null, wmRaf = null, wmTimer = null;
    let wmFrames = 0, wmLast = performance.now(), wmFps = 0;

    function wmFpsLoop(now) {
        wmFrames++;
        if (now - wmLast >= 1000) {
            wmFps = Math.round(wmFrames * 1000 / (now - wmLast));
            wmFrames = 0; wmLast = now;
        }
        wmRaf = requestAnimationFrame(wmFpsLoop);
    }

    function wmApplyCorner() {
        if (!wmEl) return;
        const c = settings.window.watermarkCorner || 'tl';
        const offs = '10px';
        wmEl.style.top = 'auto'; wmEl.style.bottom = 'auto';
        wmEl.style.left = 'auto'; wmEl.style.right = 'auto';
        if (c === 'tl') { wmEl.style.top = offs; wmEl.style.left = offs; }
        else if (c === 'tr') { wmEl.style.top = offs; wmEl.style.right = offs; }
        else if (c === 'bl') { wmEl.style.bottom = offs; wmEl.style.left = offs; }
        else { wmEl.style.bottom = offs; wmEl.style.right = offs; }
    }

    function wmBuild() {
        if (!wmEl) return;
        const parts = ['gf.util'];
        if (settings.window.watermarkUser) parts.push(getCurrentUsername());
        if (settings.window.watermarkTime) {
            const d = new Date();
            const p = n => String(n).padStart(2, '0');
            parts.push(`${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
        }
        if (settings.window.watermarkFps) parts.push(wmFps + ' fps');
        const text = parts.join(' | ');
if (wmEl.textContent !== text) wmEl.textContent = text;
    }

function wmFpsStart() {
    if (wmRaf) return;
    wmFrames = 0; wmLast = performance.now();
    wmRaf = requestAnimationFrame(wmFpsLoop);
}

function wmFpsStop() {
    if (wmRaf) { cancelAnimationFrame(wmRaf); wmRaf = null; }
}

function syncWatermark() {
    if (settings.window.watermark && !wmEl) {
        wmEl = document.createElement('div');
        wmEl.id = 'gf-watermark';
        document.body.appendChild(wmEl);
        wmTimer = setInterval(wmBuild, 250);
    } else if (!settings.window.watermark && wmEl) {
        wmEl.remove(); wmEl = null;
        clearInterval(wmTimer);
    }
    if (wmEl && settings.window.watermarkFps) wmFpsStart();
    else wmFpsStop();
    if (wmEl) { wmApplyCorner(); wmBuild(); }
}

    function getCsrfToken() {
        try {
            const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (w.gfsConfig && w.gfsConfig.csrf) return w.gfsConfig.csrf;
            if (w.GofragFish && w.GofragFish.token) return w.GofragFish.token;
        } catch (e) {}
        for (const i of document.querySelectorAll('input[type="hidden"][value="1"]')) {
            if (/^[a-f0-9]{32}$/.test(i.name || '')) return i.name;
        }
        return null;
    }

    function postFeed(task) {
        return new Promise((resolve) => {
            const token = getCsrfToken();
            if (!token) { resolve({ ok: false, msg: t('csrf_err') }); return; }
            const fd = new FormData();
            fd.append(token, '1');
            fetch(`/index.php?option=com_gofrag_community&task=${task}&format=json`, {
                method: 'POST', body: fd, credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(r => r.json())
              .then(j => resolve({ ok: !!j.success, data: j }))
              .catch(e => resolve({ ok: false, msg: String(e) }));
        });
    }

    function isQuietFail(res) {
        if (res.ok) return false;
        const msg = String((res.data && (res.data.message || res.data.error)) || res.msg || '').toLowerCase();
        return msg.includes('уже') || msg.includes('already') ||
               msg.includes('сегодня') || msg.includes('today') ||
               msg.includes('лимит') || msg.includes('limit');
    }

    function feedResultText(res) {
        if (res.ok) {
            const d = res.data;
            const income = d.income != null ? d.income : '?';
            const bal = d.new_balance != null ? d.new_balance : '?';
            const streak = d.streak != null ? d.streak : '?';
            return tf('fed_ok', { INCOME: income, BAL: bal, STREAK: streak }) + (d.stage_changed ? t('fed_new_stage') : '');
        }
        if (isQuietFail(res)) return t('fed_today');
        const d = res.data || {};
        return t('failed') + (d.message || d.error || res.msg || t('unknown_err'));
    }

    function devourerResultText(res) {
        if (res.ok) {
            const d = res.data;
            const income = d.reward_amount != null ? d.reward_amount : (d.income != null ? d.income : '?');
            return tf('fed_dev', { INCOME: income, BAL: d.balance != null ? d.balance : '?', LEFT: d.today_left != null ? d.today_left : '?' });
        }
        if (isQuietFail(res)) return t('fed_limit');
        const d = res.data || {};
        return t('failed') + (d.message || d.error || res.msg || t('unknown_err'));
    }

    const CAT_BREEDS = ['classic', 'ginger', 'siamese', 'mainecoon', 'bengal', 'neva', 'black'];
    let catSkinObserver = null;

    function catImageUrl(breed, stage, variant) {
        if (stage >= 5) return `/images/cat/appearances/${breed}/vi-${variant || 'a'}.webp`;
        if (breed === 'classic') return `/images/cat/cat_stage${stage}.webp`;
        return `/images/cat/breeds/${breed}/stage${stage}.webp`;
    }

    function applyCatSkin() {
        const img = document.getElementById('gf-tama-img');
        if (!img) return;
        if (!img.dataset.gfOrigSrc) img.dataset.gfOrigSrc = img.getAttribute('src') || '';
        const orig = img.dataset.gfOrigSrc;

        let origBreed = 'classic', origStage = null, origVariant = null;
        let m = orig.match(/\/appearances\/([a-z]+)\/vi-([abc])\.webp/i);
        if (m) {
            origBreed = m[1].toLowerCase();
            origStage = 5;
            origVariant = m[2].toLowerCase();
        } else {
            m = orig.match(/\/breeds\/([a-z]+)\/stage([0-4])\.webp/i);
            if (m) { origBreed = m[1].toLowerCase(); origStage = +m[2]; }
            else {
                m = orig.match(/cat_stage([0-4])\.webp/i);
                if (m) origStage = +m[1];
            }
        }
        if (origStage == null) {
            const tama = document.getElementById('gf-tama');
            if (tama) origStage = parseInt(tama.dataset.stage || '0', 10) || 0;
        }

        const breed = settings.cat.breed !== 'auto' ? settings.cat.breed : origBreed;
        const stage = settings.cat.stage !== 'auto' ? (parseInt(settings.cat.stage, 10) || 0) : (origStage != null ? origStage : 0);
        const variant = settings.cat.variant !== 'auto' ? settings.cat.variant : (origVariant || 'a');

        const allAuto = settings.cat.breed === 'auto' && settings.cat.stage === 'auto' && settings.cat.variant === 'auto';
        const url = allAuto ? orig : catImageUrl(CAT_BREEDS.includes(breed) ? breed : 'classic', stage, variant);
        if (img.getAttribute('src') !== url) img.setAttribute('src', url);

        if (!catSkinObserver && img.isConnected) {
            catSkinObserver = new MutationObserver(() => applyCatSkin());
            catSkinObserver.observe(img, { attributes: true, attributeFilter: ['src'] });
        }
    }

    const gfSleep = ms => new Promise(r => setTimeout(r, ms));

    function gfWaitFor(cond, timeout) {
        return new Promise(resolve => {
            const t0 = performance.now();
            (function poll() {
                if (cond()) { resolve(true); return; }
                if (performance.now() - t0 >= timeout) { resolve(false); return; }
                setTimeout(poll, 200);
            })();
        });
    }

    function gfSiteLoadMoreBtn() {
        return document.querySelector('.gf-load-more:not(.gf-load-all)');
    }

    function injectLoadAllBtn() {
        if (!settings.gamepage.commentsLoadAll) return;
        const wrap = document.querySelector('.gf-load-more-wrap');
        if (!wrap || wrap.querySelector('.gf-load-all')) return;
        const site = gfSiteLoadMoreBtn();
        if (!site) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gf-load-more gf-load-all';
        btn.textContent = settings.general.lang === 'ru' ? 'Загрузить все комментарии' : 'Load all comments';
        btn.addEventListener('click', () => runLoadAllComments(btn));
        wrap.appendChild(btn);
    }

    function removeLoadAllBtn() {
        document.querySelectorAll('.gf-load-all').forEach(b => b.remove());
    }

    let loadAllObserver = null;

    async function runLoadAllComments(btn) {
        if (btn.dataset.running === '1') return;
        btn.dataset.running = '1';
        const MAX_PAGES = 500;
        let clicked = 0;
        const ru = settings.general.lang === 'ru';
        while (clicked < MAX_PAGES) {
            const site = gfSiteLoadMoreBtn();
            if (!site || site.offsetParent === null) break;
            const before = site.getAttribute('data-page');
            site.click();
            clicked++;
            btn.textContent = ru ? `Загрузка комментариев... (${clicked})` : `Loading comments... (${clicked})`;
            const progressed = await gfWaitFor(() => {
                const s2 = gfSiteLoadMoreBtn();
                return !s2 || s2.getAttribute('data-page') !== before;
            }, 15000);
            if (!progressed) break;
            await gfSleep(150);
        }
        btn.textContent = ru ? 'Все комментарии загружены' : 'All comments loaded';
        btn.disabled = true;
        delete btn.dataset.running;
        setTimeout(() => { if (btn.isConnected) btn.remove(); }, 2500);
    }

    const MORE_EMOJI = [
        { id: 'face', icon: '😀', title: 'emo_face', list: '😀 😃 🫪 😄 😁 😆 🤣 🙂 😉 😊 😇 🥰 😘 😗 😚 😙 😋 😛 😜 😝 🤑 🤗 🤭 🤫 🤐 🤨 😐 😑 😶 😒 🤥 😌 😔 😪 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤠 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 😦 😧 😨 😰 😥 😖 😣 😞 😓 😩 😫 🥱 😤 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖' },
        { id: 'hand', icon: '👍', title: 'emo_hand', list: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤏 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🦾 👀 👁️ 👅 👄 🧠 🦴 🦷' },
        { id: 'animal', icon: '🐱', title: 'emo_animal', list: '😸 😹 😺 😻 😼 😽 🙀 😿 😾 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷️ 🦂 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐟 🐡 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦏 🐪 🦒 🐈 🐕 🐾 🦖 🦕 🐉 🦔 🐀 🐁 🐇 🐿️' },
        { id: 'food', icon: '🍕', title: 'emo_food', list: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🥦 🍄 🥜 🍞 🥐 🥖 🥨 🧀 🍖 🍗 🥩 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍣 🍤 🍙 🍚 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 ☕ 🍵 🥤 🍺 🍻 🥂 🍷 🍸 🍾 🥛 🍼' },
        { id: 'thing', icon: '🎮', title: 'emo_thing', list: '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🥊 🎮 🕹️ 🎲 🧩 🎯 🎳 🎰 🎧 🎤 🎸 🎹 🥁 🎬 📷 📱 💻 🖥️ ⌨️ 🖱️ 💾 💿 📀 🔋 🔌 💡 🔦 🔧 🔨 ⚙️ 🔑 🗝️ 🔒 🔓 💰 💎 💸 🎁 🎉 🎊 🎈 🏆 🥇 🥈 🥉 🏅 🚀 ✈️ 🚗 🏎️ 🚓 🚑 🚒 🚜 🛴 🚲 ⏰ ⌛ 📌 📎 📝 📚 ✏️ 🔍 🔔 📢 💣 🔥 ⭐ 🌟 ✨ ⚡ 🌈 ☀️ 🌙 ❄️ ☔ 🌊' },
        { id: 'symbol', icon: '❤️', title: 'emo_symbol', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 💤 ✅ ❌ ❎ ✔️ ➕ ➖ ➗ ✖️ ♾️ ❓ ❔ ❕ ❗ ‼️ ⁉️ ⚠️ 🚫 ⛔ 🔞 ♻️ ⭕ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ▶️ ⏸️ ⏩ ⏪ 🔼 🔽 ⬆️ ⬇️ ⬅️ ➡️ ↩️ 🔁 🔀 🆗 🆒 🆕 🆓 🔝 ➰ 〰️ ©️ ®️ ™️' }
    ];

    let lastTextarea = null;
    document.addEventListener('focusin', e => {
        if (e.target.tagName === 'TEXTAREA' && !e.target.closest('#gf-menu')) lastTextarea = e.target;
    }, true);

    function emojiTarget(strip) {
        const prev = strip.previousElementSibling;
        const own = prev && prev.querySelector('textarea');
        if (own) return own;
        if (lastTextarea && lastTextarea.isConnected) return lastTextarea;
        return document.getElementById('gf-comment-text');
    }

    function insertEmoji(field, emoji) {
        if (!field) return;
        const max = field.maxLength > 0 ? field.maxLength : Infinity;
        if (field.value.length + emoji.length > max) return;
        const start = field.selectionStart == null ? field.value.length : field.selectionStart;
        const end = field.selectionEnd == null ? start : field.selectionEnd;
        field.setRangeText(emoji, start, end, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.focus();
    }

    function buildMoreEmoji(strip) {
        const box = document.createElement('div');
        box.className = 'gf-more';
        const head = document.createElement('div');
        head.className = 'gf-more-head';
        const label = document.createElement('span');
        label.className = 'gf-more-label';
        const chips = document.createElement('div');
        chips.className = 'gf-more-chips';
        const grid = document.createElement('div');
        grid.className = 'gf-more-grid';
        head.append(label, chips);
        box.append(head, grid);

        const sets = MORE_EMOJI.map(c => ({ ...c, items: c.list.split(/\s+/) }));
        const total = sets.reduce((n, c) => n + c.items.length, 0);
        label.textContent = t('emoji_extra').toUpperCase() + ' · ' + total;

        function show(set) {
            grid.replaceChildren();
            for (const em of set.items) {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'gf-more-cell';
                cell.textContent = em;
                grid.appendChild(cell);
            }
            chips.querySelectorAll('.gf-more-chip').forEach(c => c.classList.toggle('on', c.dataset.id === set.id));
        }

        for (const set of sets) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'gf-more-chip';
            chip.dataset.id = set.id;
            chip.textContent = set.icon + ' ' + t(set.title);
            chip.addEventListener('click', () => show(set));
            chips.appendChild(chip);
        }

        grid.addEventListener('click', e => {
            const cell = e.target.closest('.gf-more-cell');
            if (cell) insertEmoji(emojiTarget(strip), cell.textContent);
        });

        show(sets[0]);
        return box;
    }

    function injectMoreEmoji() {
        if (!settings.gamepage.moreEmoji) return;
        document.querySelectorAll('.gf-emo-strip').forEach(strip => {
            if (!strip.querySelector(':scope > .gf-more')) strip.appendChild(buildMoreEmoji(strip));
        });
    }

    function syncMoreEmoji() {
        if (settings.gamepage.moreEmoji) injectMoreEmoji();
        else document.querySelectorAll('.gf-more').forEach(b => b.remove());
    }

    GM_addStyle(`
        .gf-more { margin-top: 6px; padding-top: 12px; border-top: 1px dashed rgba(255,255,255,.1); }
        .gf-more-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 8px; }
        .gf-more-label { font-size: 11px; font-weight: 800; letter-spacing: .08em; color: #8b8b95; white-space: nowrap; }
        .gf-more-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .gf-more-chip { padding: 4px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); color: #a1a1aa; font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
        .gf-more-chip:hover { color: #e4e4e7; }
        .gf-more-chip.on { color: #40ed70; border-color: rgba(64,237,112,.45); background: rgba(64,237,112,.1); }
        .gf-more-grid { display: grid; grid-template-columns: repeat(10, 1fr); max-height: 230px; overflow-y: auto; }
        .gf-more-cell { padding: 8px 0; border: 0; border-radius: 8px; background: transparent; font-size: 20px; line-height: 1; cursor: pointer; }
        .gf-more-cell:hover { background: rgba(255,255,255,.08); }
        @media (max-width: 640px) { .gf-more-grid { grid-template-columns: repeat(7, 1fr); } }
    `);

    function initLoadAllComments() {
        if (settings.gamepage.commentsLoadAll) injectLoadAllBtn();
        else removeLoadAllBtn();
        if (!loadAllObserver) {
            loadAllObserver = new MutationObserver(() => {
                injectLoadAllBtn();
                applyEggBadges();
                injectSidebarButton();
                injectMoreEmoji();
            });
            loadAllObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    function initMenu() {
        const menu = buildMenu();
        const qs = s => menu.querySelector(s);
        const qsa = s => menu.querySelectorAll(s);
        menu.style.setProperty('--gf-op', settings.window.opacity / 100);
        applyAll();
        applyCatSkin();
        syncWatermark();
        initLoadAllComments();
        applyEggBadges();
        syncSidebarButton();
        syncMoreEmoji();

        function clampToViewport() {
            const w = menu.offsetWidth, h = menu.offsetHeight;
            if (!w || !h) return;
            const pos = getPanelPos(menu);
            menu.style.left = Math.max(0, Math.min(pos.x, window.innerWidth - w)) + 'px';
            menu.style.top = Math.max(0, Math.min(pos.y, window.innerHeight - h)) + 'px';
        }
        window.addEventListener('resize', clampToViewport);

        let menuOpen = false, animRAF = null, curPose = { ...IM_IDENT };
        function setPose(p) {
            curPose = p;
            let tr = '';
            if (p.x || p.y) tr += `translate(${p.x}px, ${p.y}px) `;
            if (p.s !== 1) tr += `scale(${p.s})`;
            menu.style.transform = tr.trim();
            menu.style.opacity = String(Math.max(0, Math.min(1, p.o)));
        }
        function stopMenuAnim() {
            if (animRAF) { cancelAnimationFrame(animRAF); animRAF = null; }
            curPose = { ...IM_IDENT };
            menu.style.transform = ''; menu.style.opacity = ''; menu.style.pointerEvents = '';
        }
        function cancelMenuAnim() {
            if (animRAF) { cancelAnimationFrame(animRAF); animRAF = null; }
        }
        function playAnim(from, to, dur, ease, onDone) {
            const t0 = performance.now();
            const step = (now) => {
                const k = dur <= 0 ? 1 : Math.min(1, (now - t0) / dur);
                const e = ease(k);
                setPose({ o: from.o + (to.o - from.o) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, s: from.s + (to.s - from.s) * e });
                if (k < 1) animRAF = requestAnimationFrame(step);
                else { animRAF = null; onDone(); }
            };
            animRAF = requestAnimationFrame(step);
        }
        function showMenu() {
            menuOpen = true; cancelMenuAnim();
            menu.classList.add('gf-visible'); clampToViewport();
            menu.style.pointerEvents = '';
            const cfg = ANIM_TYPES[settings.window.anim];
            if (!cfg) { stopMenuAnim(); return; }
            const dur = settings.window.animDuration, ease = cfg.back ? easeOutBack : easeOutCubic;
            const mid = curPose.o < 1 || curPose.x !== 0 || curPose.y !== 0 || curPose.s !== 1;
            if (mid) playAnim(curPose, IM_IDENT, dur, ease, stopMenuAnim);
            else { setPose(cfg.pose); playAnim(cfg.pose, IM_IDENT, dur, ease, stopMenuAnim); }
        }
        function hideMenu() {
            menuOpen = false; cancelMenuAnim();
            const cfg = ANIM_TYPES[settings.window.anim];
            if (!cfg) { menu.classList.remove('gf-visible'); stopMenuAnim(); return; }
            menu.style.pointerEvents = 'none';
            playAnim(curPose, cfg.hidePose || cfg.pose, settings.window.animDuration, easeInCubic, () => { menu.classList.remove('gf-visible'); stopMenuAnim(); });
        }
        function toggleMenu() { menuOpen ? hideMenu() : showMenu(); }
        stopMenuAnimHook = stopMenuAnim;
        openMenuHook = showMenu;

        const TEXT_INPUTS = ['text', 'password', 'search', 'url', 'email', 'number', 'tel'];
        const hkBtn = qs('#gf-hotkey-btn'); let listening = false;
        function updateHotkeyUI() { hkBtn.textContent = listening ? t('press_any') : keyDisplayName(settings.window.hotkey); }
        function setListening(on) { if (listening === on) return; listening = on; hkBtn.classList.toggle('listening', on); updateHotkeyUI(); }
        hkBtn.addEventListener('click', () => setListening(!listening));
        hkBtn.addEventListener('blur', () => { if (listening) setListening(false); });
        document.addEventListener('keydown', (e) => {
            if (listening) {
                e.preventDefault(); e.stopPropagation();
                if (e.code !== 'Escape') { settings.window.hotkey = e.code; save(); }
                setListening(false);
                return;
            }
            const tgt = e.target, tag = (tgt.tagName || '').toLowerCase();
            const inField = tag === 'input' || tag === 'textarea' || tag === 'select' || tgt.isContentEditable;
            if (!inField && !e.repeat) {
                if (e.code === KONAMI[konamiPos]) {
                    konamiPos++;
                    if (konamiPos >= KONAMI.length) { konamiPos = 0; toggleFakePremod(); }
                } else {
                    konamiPos = (e.code === KONAMI[0]) ? 1 : 0;
                }
            }
            if (e.code !== settings.window.hotkey || e.repeat) return;
            if (tag === 'textarea' || tgt.isContentEditable) return;
            if (tag === 'input' && TEXT_INPUTS.includes((tgt.type || 'text').toLowerCase())) return;
            e.preventDefault(); toggleMenu();
        }, true);
        qs('#gf-close').addEventListener('click', hideMenu);
        updateHotkeyUI();

        let savedSize = null;
        function setCollapsed(c) {
            if (menu.classList.contains('collapsed') === c) return;
            menu.classList.toggle('collapsed', c);
            qs('#gf-collapse').innerHTML = c ? '&#43;' : '&#8722;';
            if (c) {
                savedSize = { w: menu.style.width, h: menu.style.height };
                menu.style.setProperty('width', 'auto', 'important');
                menu.style.setProperty('height', 'auto', 'important');
                menu.style.setProperty('max-height', 'none', 'important');
            } else {
                menu.style.removeProperty('width');
                menu.style.removeProperty('height');
                menu.style.removeProperty('max-height');
                if (savedSize) { if (savedSize.w) menu.style.width = savedSize.w; if (savedSize.h) menu.style.height = savedSize.h; }
                clampToViewport();
            }
        }
        qs('#gf-collapse').addEventListener('click', () => setCollapsed(!menu.classList.contains('collapsed')));
        qs('#gf-title').addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; setCollapsed(!menu.classList.contains('collapsed')); });

        function selectPane(name) {
            qsa('.gf-nav-item').forEach(n => n.classList.toggle('sel', n.dataset.pane === name));
            qsa('.gf-pane').forEach(p => p.classList.toggle('sel', p.dataset.pane === name));
        }
        qsa('.gf-nav-item').forEach(n => n.addEventListener('click', () => selectPane(n.dataset.pane)));
        qsa('.gf-tree-head').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));

        function wireSlider(id, onChange, fmt) {
            const input = qs('#' + id), grab = qs('#' + id + '-grab'), lbl = qs('#' + id + '-lbl');
            function sync() {
                const min = +input.min, max = +input.max, v = +input.value;
                const p = (v - min) / (max - min);
                grab.style.left = `calc(2px + (100% - 16px) * ${p})`;
                lbl.textContent = fmt(v);
            }
            input.addEventListener('input', () => { sync(); onChange(+input.value); });
            sync();
        }

        wireSlider('gf-op', v => { settings.window.opacity = v; menu.style.setProperty('--gf-op', v / 100); save(); }, v => v + '%');
        const grip = qs('#gf-grip');
        function syncWindowOpts() { grip.style.display = settings.window.noResize ? 'none' : 'block'; }
        qs('#gf-nomove').addEventListener('change', e => { settings.window.noMove = e.target.checked; save(); });
        qs('#gf-noresize').addEventListener('change', e => { settings.window.noResize = e.target.checked; save(); syncWindowOpts(); });
        qs('#gf-toast-toggle').addEventListener('change', e => { settings.window.showStartupToast = e.target.checked; save(); });
        qs('#gf-sidebar-toggle').addEventListener('change', e => {
            settings.window.sidebarButton = e.target.checked; save(); syncSidebarButton();
        });
        syncWindowOpts();

        qs('#gf-wm-on').addEventListener('change', e => { settings.window.watermark = e.target.checked; save(); syncWatermark(); });
        qs('#gf-wm-user').addEventListener('change', e => { settings.window.watermarkUser = e.target.checked; save(); syncWatermark(); });
        qs('#gf-wm-time').addEventListener('change', e => { settings.window.watermarkTime = e.target.checked; save(); syncWatermark(); });
        qs('#gf-wm-fps').addEventListener('change', e => { settings.window.watermarkFps = e.target.checked; save(); syncWatermark(); });
        const wmCornerSel = qs('#gf-wm-corner'); wmCornerSel.value = settings.window.watermarkCorner;
        wmCornerSel.addEventListener('change', () => { settings.window.watermarkCorner = wmCornerSel.value; save(); wmApplyCorner(); });

        const animSel = qs('#gf-anim'); animSel.value = settings.window.anim;
        animSel.addEventListener('change', () => { settings.window.anim = animSel.value; save(); showMenu(); });
        wireSlider('gf-animdur', v => { settings.window.animDuration = v; save(); }, v => v + 'ms');
        qs('#gf-animpreview').addEventListener('click', () => showMenu());

        const c1 = qs('#gf-c1'), c2 = qs('#gf-c2'), sw1 = qs('#gf-sw1'), sw2 = qs('#gf-sw2');
        function syncSwatches() { sw1.style.background = c1.value; sw2.style.background = c2.value; }
        c1.addEventListener('input', () => { settings.theme.tintColor1 = c1.value; syncSwatches(); applyTint(); save(); });
        c2.addEventListener('input', () => { settings.theme.tintColor2 = c2.value; syncSwatches(); applyTint(); save(); });
        wireSlider('gf-amt', v => { settings.theme.tintAmount = v; applyTint(); save(); }, v => v + '%');
        syncSwatches();

        const bgurl = qs('#gf-bgurl');
        bgurl.addEventListener('change', () => { settings.theme.bgImage = bgurl.value.trim(); applyBg(); save(); });
        qs('#gf-browse').addEventListener('click', () => qs('#gf-bgfile').click());
        qs('#gf-bgfile').addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = () => { settings.theme.bgImage = reader.result; bgurl.value = ''; applyBg(); save(); };
            reader.readAsDataURL(file);
        });
        qs('#gf-bgclear').addEventListener('click', () => { settings.theme.bgImage = ''; bgurl.value = ''; applyBg(); save(); });
        wireSlider('gf-blur', v => { settings.theme.bgBlur = v; applyBg(); save(); }, v => v + 'px');
        wireSlider('gf-dim', v => { settings.theme.bgDim = v; applyBg(); save(); }, v => v + '%');
        const fontSel = qs('#gf-font'); fontSel.value = settings.theme.font.family;
        fontSel.addEventListener('change', () => { settings.theme.font.family = fontSel.value; applyFont(); save(); });

        const curModeSel = qs('#gf-curmode'); curModeSel.value = settings.theme.cursor.mode;
        curModeSel.addEventListener('change', () => { settings.theme.cursor.mode = curModeSel.value; save(); applyCursor(); });
        const curColorInput = qs('#gf-cursor-color'), swCur = qs('#gf-swcur');
        swCur.style.background = curColorInput.value;
        curColorInput.addEventListener('input', () => { settings.theme.cursor.color = curColorInput.value; swCur.style.background = curColorInput.value; applyCursor(); save(); });
        wireSlider('gf-cursor-smooth', v => { settings.theme.cursor.smooth = v; save(); }, v => v + 'ms');
        wireSlider('gf-cursor-size', v => { settings.theme.cursor.size = v; applyCursor(); save(); }, v => v + 'px');
        wireSlider('gf-cursor-width', v => { settings.theme.cursor.width = v; applyCursor(); save(); }, v => v + 'px');
        wireSlider('gf-cursor-alpha', v => { settings.theme.cursor.alpha = v; applyCursor(); save(); }, v => v + '%');
        qs('#gf-cursor-anim').addEventListener('change', e => { settings.theme.cursor.anim = e.target.checked; save(); });

        qs('#gf-reset-theme').addEventListener('click', () => {
            settings.theme = JSON.parse(JSON.stringify(DEFAULTS.theme));
            save(); location.reload();
        });

        qs('#gf-gp-loadall').addEventListener('change', e => {
            settings.gamepage.commentsLoadAll = e.target.checked;
            save();
            if (settings.gamepage.commentsLoadAll) injectLoadAllBtn();
            else removeLoadAllBtn();
        });
        qs('#gf-entersubmit').addEventListener('change', e => {
            settings.gamepage.enterSubmit = e.target.checked; save();
        });

        qs('#gf-more-emoji').addEventListener('change', e => {
            settings.gamepage.moreEmoji = e.target.checked; save();
            syncMoreEmoji();
        });

        qs('#gf-parser-on').addEventListener('change', e => {
            settings.parser.enabled = e.target.checked; save();
        });

        const feedStatus = qs('#gf-feed-status');
        const setFeedStatus = txt => { feedStatus.textContent = txt; };
        qs('#gf-autofeed').addEventListener('change', e => { settings.cat.autoFeed = e.target.checked; save(); });
        qs('#gf-feednow').addEventListener('click', () => {
            setFeedStatus(t('feeding'));
            postFeed('api.feedMyCat').then(res => setFeedStatus(feedResultText(res)));
        });
        if (settings.cat.autoFeed) {
            setTimeout(() => {
                postFeed('api.feedMyCat').then(res => {
                    if (res.ok) {
                        const d = res.data;
                        showToast({
                            title: t('feeder'),
                            line1: tf('cat_fed', { INCOME: d.income != null ? d.income : '?' }),
                            line2: tf('cat_bal', { BAL: d.new_balance != null ? d.new_balance : '?', STREAK: d.streak != null ? d.streak : '?' }) + (d.stage_changed ? t('fed_new_stage') : '')
                        });
                        setFeedStatus(feedResultText(res));
                    } else if (isQuietFail(res)) {
                    } else if (res.msg === t('csrf_err')) {
                    } else {
                        showToast({ title: t('feeder'), line1: t('autofeed_fail'), line2: (res.data && (res.data.message || res.data.error)) || res.msg || '', life: 3200 });
                        setFeedStatus(feedResultText(res));
                    }
                });
            }, 800);
        }

        const feedStatusDev = qs('#gf-feed-status-dev');
        const setFeedStatusDev = txt => { feedStatusDev.textContent = txt; };
        qs('#gf-autofeed-dev').addEventListener('change', e => { settings.cat.autoFeedDevourer = e.target.checked; save(); });
        qs('#gf-feednow-dev').addEventListener('click', () => {
            setFeedStatusDev(t('feeding'));
            postFeed('api.feedCat').then(res => setFeedStatusDev(devourerResultText(res)));
        });
        if (settings.cat.autoFeedDevourer) {
            setTimeout(() => {
                postFeed('api.feedCat').then(res => {
                    if (res.ok) {
                        const d = res.data;
                        showToast({
                            title: t('devourer'),
                            line1: tf('dev_fed', { INCOME: d.reward_amount != null ? d.reward_amount : '?' }) + (d.reward_unlocked ? t('dev_unlock') : ''),
                            line2: tf('dev_bal', { BAL: d.balance != null ? d.balance : '?', LEFT: d.today_left != null ? d.today_left : '?' })
                        });
                        setFeedStatusDev(devourerResultText(res));
                    } else if (isQuietFail(res)) {
                    } else if (res.msg === t('csrf_err')) {
                    } else {
                        showToast({ title: t('devourer'), line1: t('autofeed_fail'), line2: (res.data && (res.data.message || res.data.error)) || res.msg || '', life: 3200 });
                        setFeedStatusDev(devourerResultText(res));
                    }
                });
            }, 1000);
        }

        const breedSel = qs('#gf-catbreed'), stageSel = qs('#gf-catstage'), variantSel = qs('#gf-catvariant');
        breedSel.value = settings.cat.breed;
        stageSel.value = settings.cat.stage;
        variantSel.value = settings.cat.variant || 'auto';
        breedSel.addEventListener('change', () => { settings.cat.breed = breedSel.value; save(); applyCatSkin(); });
        stageSel.addEventListener('change', () => { settings.cat.stage = stageSel.value; save(); applyCatSkin(); });
        variantSel.addEventListener('change', () => { settings.cat.variant = variantSel.value; save(); applyCatSkin(); });
        qs('#gf-catreset').addEventListener('click', () => {
            settings.cat.breed = 'auto'; settings.cat.stage = 'auto'; settings.cat.variant = 'auto'; save();
            breedSel.value = 'auto'; stageSel.value = 'auto'; variantSel.value = 'auto';
            applyCatSkin();
        });

        qs('#gf-random').addEventListener('click', () => {
            const rnd = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
            settings.theme.tintColor1 = rnd(); settings.theme.tintColor2 = rnd();
            if (settings.theme.tintAmount === 0) settings.theme.tintAmount = 45;
            c1.value = settings.theme.tintColor1; c2.value = settings.theme.tintColor2; syncSwatches();
            const amt = qs('#gf-amt'); amt.value = settings.theme.tintAmount; amt.dispatchEvent(new Event('input'));
            applyTint(); save();
        });
        const ioArea = qs('#gf-io');
        qs('#gf-export').addEventListener('click', () => {
            ioArea.value = JSON.stringify(settings, null, 2);
            ioArea.select();
            navigator.clipboard && navigator.clipboard.writeText(ioArea.value).catch(() => {});
        });
        qs('#gf-import').addEventListener('click', () => {
            try { settings = deepMerge(DEFAULTS, JSON.parse(ioArea.value)); save(); location.reload(); }
            catch (e) { showToast({ title: 'gf.util', line1: t('io_fail'), life: 3200 }); }
        });
        qs('#gf-reset-all').addEventListener('click', () => {
            if (!confirm(t('confirm_reset'))) return;
            settings = JSON.parse(JSON.stringify(DEFAULTS));
            save(); location.reload();
        });

        qsa('.gf-lang-btn').forEach(b => b.addEventListener('click', () => {
            if (settings.general.lang === b.dataset.lang) return;
            settings.general.lang = b.dataset.lang;
            save();
            location.reload();
        }));

        makeDraggable(menu, qs('#gf-title'));
        makeResizable(menu, grip);

        showStartupToast();
        showParserNoticeWhenReady();
    }

    function makeDraggable(panel, handle) {
        let dragging = false, offX = 0, offY = 0;
        const INTERACTIVE = 'button, input, select, textarea, label, a, .gf-nav-item, .gf-tree-head, .gf-swatch, .gf-slider-wrap, #gf-grip';
        function start(e) {
            if (stopMenuAnimHook) stopMenuAnimHook();
            dragging = true;
            const rect = panel.getBoundingClientRect();
            offX = e.clientX - rect.left; offY = e.clientY - rect.top;
            e.preventDefault();
        }
        handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || settings.window.noMove) return;
            if (e.target.closest('button')) return;
            start(e);
        });
        panel.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || settings.window.noMove) return;
            if (handle.contains(e.target)) return;
            if (e.target.closest(INTERACTIVE)) return;
            if (e.target.id === 'gf-content' || e.target.id === 'gf-nav') {
                const r = e.target.getBoundingClientRect();
                if (e.clientX > r.right - 14 || e.clientY > r.bottom - 14) return;
            }
            start(e);
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const w = panel.offsetWidth, h = panel.offsetHeight;
            panel.style.left = Math.max(0, Math.min(e.clientX - offX, window.innerWidth - w)) + 'px';
            panel.style.top = Math.max(0, Math.min(e.clientY - offY, window.innerHeight - h)) + 'px';
        });
        document.addEventListener('mouseup', () => { dragging = false; });
    }

    function makeResizable(panel, grip) {
        let rz = false, sx = 0, sy = 0, sw = 0, sh = 0;
        grip.addEventListener('mousedown', (e) => {
            if (settings.window.noResize) return;
            if (stopMenuAnimHook) stopMenuAnimHook();
            rz = true; sx = e.clientX; sy = e.clientY;
            sw = panel.offsetWidth; sh = panel.offsetHeight;
            e.preventDefault(); e.stopPropagation();
        });
        document.addEventListener('mousemove', (e) => {
            if (!rz) return;
            const pos = getPanelPos(panel);
            const availW = Math.max(400, window.innerWidth - pos.x - 2);
            const availH = Math.max(200, window.innerHeight - pos.y - 2);
            panel.style.width = Math.min(Math.max(sw + e.clientX - sx, 400), availW) + 'px';
            panel.style.height = Math.min(Math.max(sh + e.clientY - sy, 200), availH) + 'px';
        });
        document.addEventListener('mouseup', () => { rz = false; });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(initMenu, 50);
    else window.addEventListener('load', () => setTimeout(initMenu, 50));
})();




