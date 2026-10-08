// Township Overview — мультивыбор биомов, фильтр по производству и показ сломанных зданий.
// Написано под Melvor Idle v1.3.1.

const STORAGE_KEY = 'state';

/** Характеристики города, которые дают здания (кроме ресурсов) */
const STATS = [
    { key: 'population', name: 'Население', get: 'getPopulationProvidesForBiome' },
    { key: 'happiness', name: 'Счастье', get: 'getHappinessProvidesForBiome' },
    { key: 'education', name: 'Образование', get: 'getEducationProvidesForBiome' },
    { key: 'storage', name: 'Хранилище', get: 'getStorageProvidesForBiome' },
    { key: 'worship', name: 'Поклонение', get: 'getWorshipProvidesForBiome' },
    { key: 'fortification', name: 'Укрепление', get: 'getFortificationProvidesForBiome' },
    { key: 'soulStorage', name: 'Хранилище душ', get: 'getSoulStorageProvidesForBiome' },
];
const STAT_PREFIX = 'stat:';

export function setup(ctx) {
    const state = {
        multi: false,
        biomes: new Set(), // id биомов
        produces: new Set(), // id ресурсов и 'stat:<key>' для характеристик
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
            state.produces = new Set(saved.produces || saved.resources || []);
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
                produces: [...state.produces],
            });
        } catch (e) {
            console.warn('[Township Overview] не удалось сохранить настройки', e);
        }
    }

    // ---------- Логика ----------

    const esc = (s) =>
        String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    const icon = (path) => assets.getURI(path);

    function fmt(n) {
        const abs = Math.abs(n);
        if (abs >= 1000) return formatNumber(Math.round(n));
        if (abs >= 10) return String(Math.round(n));
        return String(Math.round(n * 100) / 100);
    }

    const signed = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;

    /** То же условие, по которому игра показывает карточку здания в биоме */
    function isShownInBiome(building, biome) {
        const t = township();
        return t.isBuildingAvailable(building, biome) && !t.hasBuildingBeenUpgraded(building, biome);
    }

    /**
     * Сколько зданий реально стоит. У ещё не построенной ступени улучшения
     * (0/N) работают здания предыдущей ступени, их и считаем.
     */
    function producer(building, biome) {
        const count = biome.getBuildingCount(building);
        if (count > 0) return { building, count };
        const from = building.upgradesFrom;
        if (from !== undefined && biome.getBuildingCount(from) > 0) return { building: from, count: biome.getBuildingCount(from) };
        return { building, count: 0 };
    }

    /** Сломано только то, что построено: у пустых зданий бывает «залипший» износ */
    function isBroken(building, biome) {
        return producer(building, biome).count > 0 && township().buildingRequiresRepair(building, biome);
    }

    /** Сколько зданий построит кнопка — так же, как считает сама игра */
    function buildQty(building, biome) {
        const t = township();
        const qty = t.upgradeQty > 0 ? t.upgradeQty : t.getMaxAffordableBuildingQty(building, biome);
        return Math.min(t.getBuildingCountRemainingForLevelUp(building, biome), qty);
    }

    function producesSelected(building, biome) {
        if (state.produces.size === 0) return true;
        const provides = township().getProvidesForBiome(building, biome);
        if (provides === undefined) return false;
        for (const [resource, qty] of provides.resources) {
            if (qty > 0 && state.produces.has(resource.id)) return true;
        }
        return STATS.some((s) => (provides[s.key] || 0) > 0 && state.produces.has(STAT_PREFIX + s.key));
    }

    function passesFilters(building, biome) {
        if (state.broken && !isBroken(building, biome)) return false;
        return producesSelected(building, biome);
    }

    /** Что вообще производят здания: ресурсы и характеристики (для кнопок фильтра) */
    function getProducibleOptions() {
        const resIds = new Set();
        const statKeys = new Set();
        township().buildings.forEach((building) => {
            building.provides.forEach((provides) => {
                provides.resources.forEach((qty, resource) => qty > 0 && resIds.add(resource.id));
                STATS.forEach((s) => (provides[s.key] || 0) > 0 && statKeys.add(s.key));
            });
        });
        const stats = STATS.filter((s) => statKeys.has(s.key)).map((s) => ({
            id: STAT_PREFIX + s.key,
            name: s.name,
            media: icon(townshipIcons[s.key]),
        }));
        const resources = township()
            .resources.allObjects.filter((r) => resIds.has(r.id))
            .map((r) => ({ id: r.id, name: r.name, media: r.media }));
        return { stats, resources };
    }

    function selectedBiomes() {
        const t = township();
        return t.biomes.allObjects.filter((b) => state.biomes.has(b.id) && t.isBiomeUnlocked(b));
    }

    /** Свою сетку показываем только когда выбрано больше одного биома */
    function useGrid() {
        return state.multi && selectedBiomes().length > 1;
    }

    function countBroken(biome) {
        return biome.availableBuildings.filter((b) => isShownInBiome(b, biome) && isBroken(b, biome)).length;
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
        applyMode();
    }

    function selectAllBiomes(all) {
        state.biomes.clear();
        if (all) township().biomes.forEach((b) => township().isBiomeUnlocked(b) && state.biomes.add(b.id));
        saveState();
        applyMode();
    }

    function toggleProduce(id) {
        if (id === '*') state.produces.clear();
        else if (state.produces.has(id)) state.produces.delete(id);
        else state.produces.add(id);
        saveState();
        onFiltersChanged();
    }

    function toggleBroken() {
        state.broken = !state.broken;
        saveState();
        onFiltersChanged();
    }

    function resetFilters() {
        state.produces.clear();
        state.broken = false;
        saveState();
        onFiltersChanged();
    }

    function onFiltersChanged() {
        renderFilterBar();
        townshipUI.updateTownSummary(); // перефильтровать обычный вид
        scheduleRender();
    }

    /** Ремонт и стройка в игре работают только с текущим биомом, поэтому подменяем его на время действия */
    function inBiome(biome, action) {
        const t = township();
        const prev = t.currentTownBiome;
        t.currentTownBiome = biome;
        try {
            action(t);
        } finally {
            if (t.currentTownBiome !== prev) t.setTownBiome(prev, false);
        }
        scheduleRender();
    }

    const repairIn = (building, biome) => inBiome(biome, (t) => t.repairBuilding(building));
    const buildIn = (building, biome) => inBiome(biome, (t) => t.buildBuilding(building));

    function openBiome(biome) {
        state.biomes = new Set([biome.id]);
        saveState();
        applyMode();
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

        // Один выбранный биом — обычный интерфейс игры для него
        const selected = selectedBiomes();
        if (state.multi && selected.length === 1 && township().currentTownBiome !== selected[0])
            township().setTownBiome(selected[0], false);

        const grid = useGrid();
        ui.tsTown.classList.toggle('d-none', grid);
        ui.grid.classList.toggle('d-none', !grid);
        syncHighlights();
        if (!grid) townshipUI.updateTownSummary();
        scheduleRender();
    }

    function chip(opt, on) {
        return `<button type="button" class="btn btn-sm ${on ? 'btn-info' : 'btn-outline-secondary'} tso-chip"
            data-tso-res="${esc(opt.id)}" title="${esc(opt.name)}">
            <img src="${esc(opt.media)}" class="tso-icon-sm"></button>`;
    }

    function renderFilterBar() {
        const { stats, resources } = getProducibleOptions();
        const none = state.produces.size === 0;
        ui.resChips.innerHTML =
            `<button type="button" class="btn btn-sm ${none ? 'btn-info' : 'btn-outline-secondary'} tso-chip tso-chip-all"
                data-tso-res="*">Все</button>` +
            stats.map((o) => chip(o, state.produces.has(o.id))).join('') +
            '<span class="tso-sep"></span>' +
            resources.map((o) => chip(o, state.produces.has(o.id))).join('');

        ui.brokenBtn.classList.toggle('btn-danger', state.broken);
        ui.brokenBtn.classList.toggle('btn-outline-danger', !state.broken);
        ui.resetBtn.classList.toggle('d-none', !(state.broken || state.produces.size > 0));
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

    function statLine(img, value, title, hl) {
        const cls = value < 0 ? 'text-danger' : 'text-success';
        return `<span class="tso-res${hl ? ' tso-res-hl' : ''}" title="${esc(title)}">
            <img src="${esc(img)}" class="tso-icon-sm"><span class="${cls}">${signed(value)}</span></span>`;
    }

    /** Сколько ресурса есть у игрока — как в игре: GP и AP хранятся отдельно от ресурсов города */
    function haveAmount(resource) {
        switch (resource.id) {
            case 'melvorF:GP':
                return game.gp.amount;
            case 'melvorItA:AP':
                return game.abyssalPieces !== undefined ? game.abyssalPieces.amount : 0;
            default:
                return resource.amount;
        }
    }

    function costItem(resource, cost) {
        const cls = haveAmount(resource) >= cost ? 'text-success' : 'text-danger font-w600';
        return `<span class="tso-res ${cls}"><img src="${esc(resource.media)}" class="tso-icon-sm">${fmt(cost)}</span>`;
    }

    /** Стоимость постройки qty зданий — та же формула, что в карточке игры */
    function renderBuildCost(building, biome, qty) {
        const t = township();
        return t
            .getBuildingCostsForBiome(building, biome)
            .map(({ resource, quantity }) => {
                let cost = quantity * qty;
                if (resource.type !== TownshipResourceTypeID.Currency) cost = t.modifyBuildingResourceCost(cost);
                return cost > 0 ? costItem(resource, cost) : '';
            })
            .join('');
    }

    function renderRepairCost(building, biome) {
        const t = township();
        const forCosts =
            biome.getBuildingCount(building) === 0 && building.upgradesFrom !== undefined ? building.upgradesFrom : building;
        return t
            .getBuildingCostsForBiome(forCosts, biome)
            .map(({ resource, quantity }) => {
                return costItem(resource, Math.floor(t.getSingleResourceRepairCostForBuilding(building, biome, quantity)));
            })
            .join('');
    }

    function renderCard(building, biome) {
        const t = township();
        const count = biome.getBuildingCount(building);
        const max = building.maxUpgrades;
        const eff = t.getBuildingEfficiencyInBiome(building, biome);
        const effClass = eff >= 100 ? 'text-success' : eff >= 50 ? 'text-warning' : 'text-danger';
        const src = producer(building, biome);
        const provides = t.getProvidesForBiome(src.building, biome);

        // Итоговое производство всех зданий этого типа, с учётом износа
        let out = '';
        STATS.forEach((s) => {
            if (provides === undefined || !provides[s.key]) return;
            const v = t[s.get](src.building, biome) * src.count;
            if (v !== 0) out += statLine(icon(townshipIcons[s.key]), v, s.name, state.produces.has(STAT_PREFIX + s.key));
        });
        if (provides !== undefined) {
            provides.resources.forEach((qty, resource) => {
                if (qty === 0) return;
                const v = t.getSingleResourceGainAmountInBiome(resource, src.building, biome, true) * src.count;
                out += statLine(resource.media, v, `${resource.name} за тик`, state.produces.has(resource.id));
            });
        }

        const upgradeName = building.upgradesTo !== undefined ? building.upgradesTo.name : '';
        const pct = max > 0 ? Math.min(100, (count / max) * 100) : 0;

        let buildHtml = '';
        let buildCostHtml = '';
        if (count < max) {
            const qty = buildQty(building, biome);
            const tierOk = t.canBuildTierOfBuilding(building);
            const can = tierOk && qty > 0 && t.canAffordBuilding(building, biome, qty);
            const why = !tierOk ? 'Не выполнены требования' : 'Не хватает ресурсов';
            buildHtml = `<button type="button" class="btn btn-sm btn-success mr-1" data-tso-build="${esc(building.id)}"
                data-tso-biome="${esc(biome.id)}" ${can ? '' : `disabled title="${why}"`}>
                <i class="fa fa-hammer mr-1"></i>Построить${qty > 1 ? ` ×${qty}` : ''}</button>`;
            buildCostHtml = `<div class="mt-1"><small class="font-w600 mr-1">Стоимость (${Math.max(qty, 1)}):</small>
                <small>${renderBuildCost(building, biome, Math.max(qty, 1))}</small></div>`;
        }

        let repairHtml = '';
        if (isBroken(building, biome)) {
            const canAfford = t.canAffordRepair(building, biome);
            repairHtml = `<div class="mt-1 d-flex flex-wrap align-items-center">
                <button type="button" class="btn btn-sm btn-warning mr-2" data-tso-repair="${esc(building.id)}"
                    data-tso-biome="${esc(biome.id)}" ${canAfford ? '' : 'disabled title="Не хватает ресурсов"'}>
                    <i class="fa fa-tools mr-1"></i>Починить</button>
                <small>${renderRepairCost(building, biome)}</small>
            </div>`;
        }

        return `<div class="col-12 col-md-6 col-xl-4 p-1">
            <div class="block block-rounded mb-0 p-2 h-100 tso-card ${isBroken(building, biome) ? 'tso-broken' : ''}">
                <div class="d-flex align-items-start">
                    <img src="${esc(building.media)}" class="tso-icon-lg mr-2">
                    <div class="flex-grow-1 min-w-0">
                        <div class="d-flex justify-content-between">
                            <span class="font-w600">${esc(building.name)}</span>
                            ${src.count > 0 ? `<small class="${effClass} font-w600 text-nowrap ml-1"><i class="fa fa-tools"></i> ${fmt(eff)}%</small>` : ''}
                        </div>
                        <div class="progress tso-progress mt-1">
                            <div class="progress-bar ${count >= max ? 'bg-success' : 'bg-info'}" style="width:${pct}%"></div>
                        </div>
                        <small class="text-muted">${count} / ${max}${upgradeName ? ` до улучшения: ${esc(upgradeName)}` : ''}</small>
                    </div>
                </div>
                ${out ? `<div class="mt-1">${out}</div>` : ''}
                ${buildCostHtml}
                ${repairHtml}
                <div class="mt-1">
                    ${buildHtml}
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-tso-open="${esc(biome.id)}">
                        <i class="fa fa-external-link-alt mr-1"></i>Открыть биом</button>
                </div>
            </div>
        </div>`;
    }

    function renderGrid() {
        let html = '';
        let shown = 0;
        for (const biome of selectedBiomes()) {
            const cards = biome.availableBuildings
                .filter((b) => isShownInBiome(b, biome) && passesFilters(b, biome))
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
        if (useGrid()) renderGrid();
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
                    <span data-tso="chips" class="d-flex flex-wrap align-items-center"></span>
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
            if (btn) toggleProduce(btn.dataset.tsoRes);
        };

        // Своя сетка зданий для нескольких биомов
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
            const build = e.target.closest('[data-tso-build]');
            if (build) {
                const building = t.buildings.getObjectByID(build.dataset.tsoBuild);
                const biome = t.biomes.getObjectByID(build.dataset.tsoBiome);
                if (building && biome) buildIn(building, biome);
                return;
            }
            const open = e.target.closest('[data-tso-open]');
            if (open) {
                const biome = t.biomes.getObjectByID(open.dataset.tsoOpen);
                if (biome) openBiome(biome);
            }
        };

        const filterRow = createElement('div', { className: 'row no-gutters' });
        filterRow.append(filterBar);
        tsTown.before(filterRow, ui.grid);

        initialized = true;
        renderFilterBar();
        applyMode();
    }

    // ---------- Патчи игры ----------

    // Фильтры в обычном виде: прячем карточки, которые не подходят
    ctx.patch(TownshipUI, 'updateTownSummaryForBuilding').after(function (_ret, building) {
        if (!initialized || useGrid()) return;
        const biome = township().currentTownBiome;
        const el = townshipUI.buildingsInTown.get(building);
        if (biome === undefined || el === undefined) return;
        if (!passesFilters(building, biome)) hideElement(el);
    });

    ctx.patch(TownshipUI, 'updateTownSummary').after(() => scheduleRender());

    // Износ зданий меняет эффективность без пересборки сводки
    ctx.patch(TownshipUI, 'updateAllBuildingEfficiency').after(() => {
        if (!initialized) return;
        if (state.broken && !useGrid()) townshipUI.updateTownSummary();
        scheduleRender();
    });

    // Ресурсы изменились — обновить цены (зелёный/красный) и доступность кнопок
    ctx.patch(TownshipUI, 'updateResourceAmounts').after(() => {
        if (initialized && useGrid()) scheduleRender();
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
