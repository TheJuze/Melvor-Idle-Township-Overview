// Township Overview — мультивыбор биомов, фильтр по ресурсам и показ сломанных зданий.
// Написано под Melvor Idle v1.3.1.

const STORAGE_KEY = 'state';

export function setup(ctx) {
    const state = {
        multi: false,
        biomes: new Set(), // id биомов
        resources: new Set(), // id ресурсов
        broken: false,
    };

    let initialized = false;
    let renderQueued = false;
    const ui = {}; // DOM-элементы мода
    const brokenBadges = new Map(); // biome -> span

    const township = () => game.township;

    // ---------- Сохранение ----------

    function loadState() {
        try {
            const saved = ctx.characterStorage.getItem(STORAGE_KEY);
            if (!saved) return;
            state.multi = !!saved.multi;
            state.broken = !!saved.broken;
            state.biomes = new Set(saved.biomes || []);
            state.resources = new Set(saved.resources || []);
        } catch (e) {
            console.warn('[Township Overview] не удалось загрузить настройки', e);
        }
    }

    function saveState() {
        try {
            ctx.characterStorage.setItem(STORAGE_KEY, {
                multi: state.multi,
                broken: state.broken,
                biomes: [...state.biomes],
                resources: [...state.resources],
            });
        } catch (e) {
            console.warn('[Township Overview] не удалось сохранить настройки', e);
        }
    }

    // ---------- Логика ----------

    const esc = (s) =>
        String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    function fmt(n) {
        const abs = Math.abs(n);
        if (abs >= 1000) return formatNumber(Math.round(n));
        if (abs >= 10) return String(Math.round(n));
        return String(Math.round(n * 10) / 10);
    }

    /** Здание реально стоит в биоме и не заменено улучшением */
    function isBuiltInBiome(building, biome) {
        return biome.getBuildingCount(building) > 0 && !township().hasBuildingBeenUpgraded(building, biome);
    }

    function isBroken(building, biome) {
        return township().buildingRequiresRepair(building, biome);
    }

    function producesSelectedResource(building, biome) {
        if (state.resources.size === 0) return true;
        const provides = township().getProvidesForBiome(building, biome);
        if (provides === undefined) return false;
        for (const [resource, qty] of provides.resources) {
            if (qty > 0 && state.resources.has(resource.id)) return true;
        }
        return false;
    }

    function passesFilters(building, biome) {
        if (state.broken && !isBroken(building, biome)) return false;
        return producesSelectedResource(building, biome);
    }

    /** Ресурсы, которые хоть какое-то здание производит (для кнопок фильтра) */
    function getProducibleResources() {
        const ids = new Set();
        township().buildings.forEach((building) => {
            building.provides.forEach((provides) => {
                provides.resources.forEach((qty, resource) => {
                    if (qty > 0) ids.add(resource.id);
                });
            });
        });
        return township().resources.allObjects.filter((r) => ids.has(r.id));
    }

    function selectedBiomes() {
        const t = township();
        return t.biomes.allObjects.filter((b) => state.biomes.has(b.id) && t.isBiomeUnlocked(b));
    }

    function countBroken(biome) {
        let n = 0;
        biome.buildingsBuilt.forEach((_, building) => {
            if (isBuiltInBiome(building, biome) && isBroken(building, biome)) n++;
        });
        return n;
    }

    // ---------- Действия ----------

    function setMulti(on) {
        state.multi = on;
        if (on && state.biomes.size === 0 && township().currentTownBiome)
            state.biomes.add(township().currentTownBiome.id);
        saveState();
        applyMode();
    }

    function toggleBiome(biome) {
        if (!township().isBiomeUnlocked(biome)) return;
        if (state.biomes.has(biome.id)) state.biomes.delete(biome.id);
        else state.biomes.add(biome.id);
        saveState();
        syncHighlights();
        scheduleRender();
    }

    function selectAllBiomes(all) {
        state.biomes.clear();
        if (all) township().biomes.forEach((b) => township().isBiomeUnlocked(b) && state.biomes.add(b.id));
        saveState();
        syncHighlights();
        scheduleRender();
    }

    function toggleResource(id) {
        if (state.resources.has(id)) state.resources.delete(id);
        else state.resources.add(id);
        saveState();
        onFiltersChanged();
    }

    function toggleBroken() {
        state.broken = !state.broken;
        saveState();
        onFiltersChanged();
    }

    function resetFilters() {
        state.resources.clear();
        state.broken = false;
        saveState();
        onFiltersChanged();
    }

    function onFiltersChanged() {
        renderFilterBar();
        townshipUI.updateTownSummary(); // перефильтровать обычный вид
        scheduleRender();
    }

    function repairIn(building, biome) {
        const t = township();
        const prev = t.currentTownBiome;
        // repairBuilding работает только с текущим биомом, поэтому подменяем его на время ремонта
        t.currentTownBiome = biome;
        try {
            t.repairBuilding(building);
        } finally {
            if (t.currentTownBiome !== prev) t.setTownBiome(prev, false);
        }
        scheduleRender();
    }

    function openBiome(biome) {
        setMulti(false);
        township().setTownBiome(biome);
    }

    // ---------- Отрисовка ----------

    function syncHighlights() {
        const t = township();
        townshipUI.townBiomeSelectButtons.forEach((el, biome) => {
            const on = state.multi ? state.biomes.has(biome.id) : biome === t.currentTownBiome;
            if (on) el.highlight(biome);
            else el.unhighlight(biome);
        });
    }

    function applyMode() {
        if (!initialized) return;
        ui.multiBtn.classList.toggle('btn-primary', state.multi);
        ui.multiBtn.classList.toggle('btn-outline-primary', !state.multi);
        ui.multiBtn.innerHTML = state.multi
            ? '<i class="fa fa-check-square mr-1"></i>Мультивыбор'
            : '<i class="far fa-square mr-1"></i>Мультивыбор';
        ui.biomeBulk.classList.toggle('d-none', !state.multi);
        ui.tsTown.classList.toggle('d-none', state.multi);
        ui.grid.classList.toggle('d-none', !state.multi);
        syncHighlights();
        if (!state.multi) townshipUI.updateTownSummary();
        scheduleRender();
    }

    function renderFilterBar() {
        const chips = getProducibleResources()
            .map((r) => {
                const on = state.resources.has(r.id);
                return `<button type="button" class="btn btn-sm ${on ? 'btn-info' : 'btn-outline-secondary'} tso-chip"
                    data-tso-res="${esc(r.id)}" title="${esc(r.name)}">
                    <img src="${esc(r.media)}" class="tso-icon-sm"></button>`;
            })
            .join('');
        ui.resChips.innerHTML = chips;

        ui.brokenBtn.classList.toggle('btn-danger', state.broken);
        ui.brokenBtn.classList.toggle('btn-outline-danger', !state.broken);
        const hasFilters = state.broken || state.resources.size > 0;
        ui.resetBtn.classList.toggle('d-none', !hasFilters);
    }

    function updateBrokenCounts() {
        let total = 0;
        township().biomes.forEach((biome) => {
            const badge = brokenBadges.get(biome);
            const n = township().isBiomeUnlocked(biome) ? countBroken(biome) : 0;
            total += n;
            if (badge) {
                badge.textContent = n > 0 ? `🔧${n}` : '';
                badge.classList.toggle('d-none', n === 0);
            }
        });
        ui.brokenCount.textContent = total > 0 ? ` (${total})` : '';
    }

    function renderCard(building, biome) {
        const t = township();
        const count = biome.getBuildingCount(building);
        const eff = t.getBuildingEfficiencyInBiome(building, biome);
        const effClass = eff >= 100 ? 'text-success' : eff >= 50 ? 'text-warning' : 'text-danger';
        const provides = t.getProvidesForBiome(building, biome);

        let resHtml = '';
        if (provides !== undefined) {
            provides.resources.forEach((qty, resource) => {
                if (qty === 0) return;
                const amount = t.getSingleResourceGainAmountInBiome(resource, building, biome, true) * count;
                const cls = amount < 0 ? 'text-danger' : '';
                const hl = state.resources.has(resource.id) ? ' tso-res-hl' : '';
                resHtml += `<span class="tso-res${hl} ${cls}" title="${esc(resource.name)}">
                    <img src="${esc(resource.media)}" class="tso-icon-sm">${amount > 0 ? '+' : ''}${fmt(amount)}</span>`;
            });
        }

        let repairHtml = '';
        if (eff < 100) {
            const canAfford = t.canAffordRepair(building, biome);
            repairHtml = `<button type="button" class="btn btn-sm btn-warning" data-tso-repair="${esc(building.id)}"
                data-tso-biome="${esc(biome.id)}" ${canAfford ? '' : 'disabled title="Не хватает ресурсов"'}>
                <i class="fa fa-tools mr-1"></i>Починить</button>`;
        }

        return `<div class="col-12 col-md-6 col-xl-4 p-1">
            <div class="block block-rounded mb-0 p-2 h-100 tso-card ${eff < 100 ? 'tso-broken' : ''}">
                <div class="d-flex align-items-center">
                    <img src="${esc(building.media)}" class="tso-icon-lg mr-2">
                    <div class="flex-grow-1">
                        <div class="font-w600">${esc(building.name)}</div>
                        <small class="text-muted">${count} / ${building.maxUpgrades}</small>
                        <small class="${effClass} font-w600 ml-2"><i class="fa fa-tools"></i> ${fmt(eff)}%</small>
                    </div>
                </div>
                ${resHtml ? `<div class="mt-1">${resHtml} <small class="text-muted">/тик</small></div>` : ''}
                <div class="mt-1">
                    ${repairHtml}
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-tso-open="${esc(biome.id)}">
                        <i class="fa fa-external-link-alt mr-1"></i>В биом</button>
                </div>
            </div>
        </div>`;
    }

    function renderGrid() {
        const biomes = selectedBiomes();
        if (biomes.length === 0) {
            ui.grid.innerHTML = `<div class="col-12 p-3 text-muted">Выбери один или несколько биомов слева.</div>`;
            return;
        }
        let html = '';
        let shown = 0;
        for (const biome of biomes) {
            const cards = biome.availableBuildings
                .filter((b) => isBuiltInBiome(b, biome) && passesFilters(b, biome))
                .map((b) => renderCard(b, biome));
            if (cards.length === 0) continue;
            shown += cards.length;
            html += `<div class="col-12 mt-2 mb-1 tso-biome-header">
                <img src="${esc(biome.media)}" class="tso-icon-md mr-1">
                <span class="font-w600">${esc(biome.name)}</span>
                <small class="text-muted ml-1">${cards.length}</small>
            </div>${cards.join('')}`;
        }
        if (shown === 0) html = `<div class="col-12 p-3 text-muted">Под фильтры ничего не подходит.</div>`;
        ui.grid.innerHTML = html;
    }

    function render() {
        renderQueued = false;
        if (!initialized) return;
        updateBrokenCounts();
        if (state.multi) renderGrid();
    }

    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(render);
    }

    // ---------- Построение интерфейса ----------

    function init() {
        if (initialized) return;
        const biomeList = document.getElementById('TOWNSHIP_BIOME_SELECT_ELEMENTS');
        const tsTown = document.getElementById('ts-town');
        if (!biomeList || !tsTown || townshipUI.townBiomeSelectButtons.size === 0) return;
        ui.tsTown = tsTown;

        // Панель над списком биомов
        const biomeBar = createElement('div', { className: 'tso-biome-bar mb-2' });
        biomeBar.innerHTML = `
            <button type="button" class="btn btn-sm btn-outline-primary" data-tso="multi"></button>
            <span data-tso="bulk">
                <button type="button" class="btn btn-sm btn-outline-secondary" data-tso="all">Все</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-tso="none">Сброс</button>
            </span>`;
        biomeList.before(biomeBar);
        ui.multiBtn = biomeBar.querySelector('[data-tso="multi"]');
        ui.biomeBulk = biomeBar.querySelector('[data-tso="bulk"]');
        ui.multiBtn.onclick = () => setMulti(!state.multi);
        biomeBar.querySelector('[data-tso="all"]').onclick = () => selectAllBiomes(true);
        biomeBar.querySelector('[data-tso="none"]').onclick = () => selectAllBiomes(false);

        // Клик по биому: в режиме мультивыбора переключает, иначе ведёт себя как обычно
        townshipUI.townBiomeSelectButtons.forEach((el, biome) => {
            const original = el.selectButton.onclick;
            el.selectButton.onclick = (e) => (state.multi ? toggleBiome(biome) : original && original.call(el.selectButton, e));
            const badge = createElement('span', { className: 'badge badge-danger ml-1 d-none tso-broken-badge' });
            el.biomeProgress.after(badge);
            brokenBadges.set(biome, badge);
        });

        // Панель фильтров над зданиями
        const filterBar = createElement('div', { className: 'col-12 tso-filter-bar mb-2' });
        filterBar.innerHTML = `
            <div class="block block-rounded mb-0 p-2">
                <div class="d-flex flex-wrap align-items-center">
                    <small class="font-w600 mr-2">Производит:</small>
                    <span data-tso="chips" class="d-flex flex-wrap"></span>
                </div>
                <div class="mt-1">
                    <button type="button" class="btn btn-sm btn-outline-danger" data-tso="broken">
                        <i class="fa fa-tools mr-1"></i>Сломанные<span data-tso="broken-count"></span></button>
                    <button type="button" class="btn btn-sm btn-outline-secondary d-none" data-tso="reset">Сбросить фильтры</button>
                </div>
            </div>`;
        ui.resChips = filterBar.querySelector('[data-tso="chips"]');
        ui.brokenBtn = filterBar.querySelector('[data-tso="broken"]');
        ui.brokenCount = filterBar.querySelector('[data-tso="broken-count"]');
        ui.resetBtn = filterBar.querySelector('[data-tso="reset"]');
        ui.brokenBtn.onclick = toggleBroken;
        ui.resetBtn.onclick = resetFilters;
        ui.resChips.onclick = (e) => {
            const btn = e.target.closest('[data-tso-res]');
            if (btn) toggleResource(btn.dataset.tsoRes);
        };

        // Своя сетка зданий для режима мультивыбора
        ui.grid = createElement('div', { className: `${tsTown.className} tso-grid d-none` });
        ui.grid.onclick = (e) => {
            const t = township();
            const repair = e.target.closest('[data-tso-repair]');
            if (repair) {
                const building = t.buildings.getObjectByID(repair.dataset.tsoRepair);
                const biome = t.biomes.getObjectByID(repair.dataset.tsoBiome);
                if (building && biome) repairIn(building, biome);
                return;
            }
            const open = e.target.closest('[data-tso-open]');
            if (open) {
                const biome = t.biomes.getObjectByID(open.dataset.tsoOpen);
                if (biome) openBiome(biome);
            }
        };

        // Если ts-town сам является .row — фильтр кладём отдельной строкой перед ним
        const filterRow = createElement('div', { className: 'row no-gutters' });
        filterRow.append(filterBar);
        tsTown.before(filterRow, ui.grid);

        initialized = true;
        renderFilterBar();
        applyMode();
    }

    // ---------- Патчи игры ----------

    // Фильтры в обычном (одиночном) режиме: прячем карточки, которые не подходят
    ctx.patch(TownshipUI, 'updateTownSummaryForBuilding').after(function (_ret, building) {
        if (!initialized || state.multi) return;
        const biome = township().currentTownBiome;
        const el = townshipUI.buildingsInTown.get(building);
        if (biome === undefined || el === undefined) return;
        if (!passesFilters(building, biome)) hideElement(el);
    });

    ctx.patch(TownshipUI, 'updateTownSummary').after(() => scheduleRender());

    // Износ зданий меняет эффективность без пересборки сводки
    ctx.patch(TownshipUI, 'updateAllBuildingEfficiency').after(() => {
        if (!initialized) return;
        if (state.broken && !state.multi) townshipUI.updateTownSummary();
        scheduleRender();
    });

    ctx.patch(Township, 'setTownBiome').after(() => {
        if (initialized && state.multi) syncHighlights();
    });

    // UI города строится при загрузке персонажа или при создании города
    ctx.patch(TownshipUI, 'loadTownshipUI').after(() => {
        init();
        if (initialized) applyMode();
    });

    ctx.onCharacterLoaded(() => {
        loadState();
        if (initialized) {
            renderFilterBar();
            applyMode();
        }
    });
    ctx.onInterfaceReady(() => init());
}
