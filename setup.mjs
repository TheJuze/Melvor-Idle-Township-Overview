// Township Overview — мультивыбор биомов, фильтр по производству и показ сломанных зданий.
// Интерфейс на русском или английском — по языку игры.
// Написано под Melvor Idle v1.3.1.

const STORAGE_KEY = 'state';

const STRINGS = {
    en: {
        multi: 'Multi-select',
        all: 'All',
        clear: 'Clear',
        produces: 'Produces:',
        broken: 'Broken',
        resetFilters: 'Reset filters',
        openBiome: 'Open biome',
        repairAllInBiome: 'Repair all in biome',
        nothingFound: 'Nothing matches the filters.',
        population: 'Population',
        happiness: 'Happiness',
        education: 'Education',
        storage: 'Storage',
        worship: 'Worship',
        fortification: 'Fortification',
        soulStorage: 'Soul storage',
    },
    ru: {
        multi: 'Мультивыбор',
        all: 'Все',
        clear: 'Сброс',
        produces: 'Производит:',
        broken: 'Сломанные',
        resetFilters: 'Сбросить фильтры',
        openBiome: 'Открыть биом',
        repairAllInBiome: 'Починить все в биоме',
        nothingFound: 'Под фильтры ничего не подходит.',
        population: 'Население',
        happiness: 'Счастье',
        education: 'Образование',
        storage: 'Хранилище',
        worship: 'Поклонение',
        fortification: 'Укрепление',
        soulStorage: 'Хранилище душ',
    },
};

/** Строка интерфейса на языке игры (русский или английский) */
const tr = (key) => (STRINGS[setLang] || STRINGS.en)[key];

/** Характеристики города, которые дают здания (кроме ресурсов) */
const STATS = ['population', 'happiness', 'education', 'storage', 'worship', 'fortification', 'soulStorage'].map((key) => ({
    key,
    get name() {
        return tr(key);
    },
}));
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
            console.warn('[Township Overview] failed to load settings', e);
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
            console.warn('[Township Overview] failed to save settings', e);
        }
    }

    // ---------- Логика ----------

    const esc = (s) =>
        String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    const icon = (path) => assets.getURI(path);

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
            ? `<i class="fa fa-check-square mr-1"></i>${tr('multi')}`
            : `<i class="far fa-square mr-1"></i>${tr('multi')}`;
        ui.biomeBulk.classList.toggle('d-none', !state.multi);

        // Один выбранный биом — обычный интерфейс игры для него
        const selected = selectedBiomes();
        if (state.multi && selected.length === 1 && township().currentTownBiome !== selected[0])
            township().setTownBiome(selected[0], false);

        // В сетке прячем только игровые карточки зданий (CSS), а ряды «Починить все» и здоровья остаются.
        // Кнопка «Починить все в биоме» в сетке переезжает в заголовок каждого биома.
        const grid = useGrid();
        ui.tsTown.classList.toggle('tso-grid-mode', grid);
        ui.gridWrap.classList.toggle('d-none', !grid);
        if (ui.biomeRepairRow) ui.biomeRepairRow.classList.toggle('d-none', grid);
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
                data-tso-res="*">${tr('all')}</button>` +
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

    /** Проверить, что у здания можно сделать, и оставить на карточке только эти кнопки */
    function applyActions(el, building, biome) {
        const t = township();
        const maxed = t.isBuildingMaxed(building, biome);
        const canTier = t.canBuildTierOfBuilding(building);
        const canBuild = !maxed && canTier;
        const broken = isBroken(building, biome);

        // Жёлтая кнопка ремонта — рядом с зелёной кнопкой стройки
        if (el.repairButton.previousElementSibling !== el.upgradeButtonGroup) {
            el.upgradeButtonGroup.after(el.repairButton);
            el.repairButton.classList.add('tso-repair-btn');
        }

        if (!maxed && !canTier) showElement(el.requirementsContainer);
        else hideElement(el.requirementsContainer);

        if (canBuild) {
            showElement(el.upgradesToContainer);
            showElement(el.upgradeButtonGroup);
        } else {
            hideElement(el.upgradesToContainer);
            hideElement(el.upgradeButtonGroup);
        }

        // Рядом с кнопкой стройки — по верху, одна — по центру
        alignRepairButton(el, canBuild && broken);

        if (broken) {
            el.updateBuildingRepairCosts(building, t);
            showElement(el.repairContainer);
            showElement(el.repairButton);
        } else {
            hideElement(el.repairContainer);
            hideElement(el.repairButton);
        }
    }

    /**
     * Разметку вокруг кнопок задаёт игра, поэтому выравниваем по факту:
     * меряем, насколько жёлтая кнопка ниже зелёной, и сдвигаем её вверх.
     */
    function alignRepairButton(el, both) {
        el.repairButton.style.transform = '';
        if (!both) return;
        requestAnimationFrame(() => {
            if (el.repairButton.offsetParent === null || el.upgradeButton.offsetParent === null) return;
            el.repairButton.style.transform = '';
            const d = el.upgradeButton.getBoundingClientRect().top - el.repairButton.getBoundingClientRect().top;
            if (Math.abs(d) > 0.5) el.repairButton.style.transform = `translateY(${d}px)`;
        });
    }

    /** Подменить текущий биом без побочных эффектов — чтобы игровая карточка нарисовалась для другого биома */
    function withBiomeSilently(biome, fn) {
        const t = township();
        const prev = t.currentTownBiome;
        t.currentTownBiome = biome;
        try {
            fn(t);
        } finally {
            t.currentTownBiome = prev;
        }
    }

    /** «Починить все в биоме» со стоимостью — для заголовка биома в сетке */
    function renderRepairAll(biome) {
        if (countBroken(biome) === 0) return '';
        const t = township();
        const costs = t.getTotalRepairCostInBiome(biome);
        const can = t.canAffordRepairAllCosts(costs);
        return `<button type="button" class="btn btn-sm btn-warning ml-2 tso-open-btn" data-tso-repair-all="${esc(biome.id)}"
                ${can ? '' : 'disabled'}><i class="fa fa-tools mr-1"></i>${tr('repairAllInBiome')}</button>
            <ul class="nav-main nav-main-horizontal nav-main-horizontal-override font-w400 font-size-xs ml-2 mb-0 tso-inline-costs">
                ${townshipUI.getRepairAllCostHTML(costs)}</ul>`;
    }

    const gridCards = new Map(); // `${biome.id}|${building.id}` -> BuildingInTownElement
    const gridHeaders = new Map(); // biome.id -> div

    function getGridCard(building, biome) {
        const key = `${biome.id}|${building.id}`;
        let el = gridCards.get(key);
        if (el === undefined) {
            el = new BuildingInTownElement();
            el.className = 'col-12 col-sm-6 col-xl-4';
            el.initQtyDropdowns(townshipUI);
            gridCards.set(key, el);
        }
        return el;
    }

    function updateGridCard(el, building, biome) {
        withBiomeSilently(biome, (t) => {
            el.setBuilding(building, t);
            el.updateBuildingRequirements(building, t);
            applyActions(el, building, biome);
        });
        // setBuilding вешает обработчики на текущий биом — перевешиваем на биом карточки
        el.upgradeButton.onclick = () => buildIn(building, biome);
        el.repairButton.onclick = () => repairIn(building, biome);
    }

    function renderGrid() {
        const nodes = [];
        const pending = [];
        for (const biome of selectedBiomes()) {
            const buildings = biome.availableBuildings.filter((b) => isShownInBiome(b, biome) && passesFilters(b, biome));
            if (buildings.length === 0) continue;
            let header = gridHeaders.get(biome.id);
            if (header === undefined) {
                header = createElement('div', { className: 'col-12 mt-2 mb-1 d-flex flex-wrap align-items-center tso-biome-header' });
                gridHeaders.set(biome.id, header);
            }
            header.innerHTML = `<img src="${esc(biome.media)}" class="tso-icon-md mr-1">
                <span class="font-w600">${esc(biome.name)}</span>
                <small class="text-muted ml-1">${buildings.length}</small>
                <button type="button" class="btn btn-sm btn-outline-secondary ml-2 tso-open-btn" data-tso-open="${esc(biome.id)}">
                    <i class="fa fa-external-link-alt mr-1"></i>${tr('openBiome')}</button>
                ${renderRepairAll(biome)}`;
            nodes.push(header);
            for (const building of buildings) {
                const el = getGridCard(building, biome);
                nodes.push(el);
                pending.push([el, building, biome]);
            }
        }
        if (nodes.length === 0) {
            nodes.push(createElement('div', { className: 'col-12 p-3 text-muted', text: tr('nothingFound') }));
        }
        // Сначала вставляем в DOM (карточка дособирается в connectedCallback), потом заполняем.
        // Если состав не поменялся — DOM не трогаем: при каждой вставке карточка создаёт новую подсказку.
        const current = ui.grid.children;
        const same = current.length === nodes.length && nodes.every((n, i) => current[i] === n);
        if (!same) {
            ui.grid.replaceChildren(...nodes);
            pending.forEach(([el]) => {
                if (el._tsoTooltip && el._tsoTooltip !== el.upgradesToTooltip) el._tsoTooltip.destroy();
                el._tsoTooltip = el.upgradesToTooltip;
            });
        }
        pending.forEach(([el, building, biome]) => updateGridCard(el, building, biome));
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
                <button type="button" class="btn btn-sm btn-outline-secondary" data-tso="all">${tr('all')}</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-tso="none">${tr('clear')}</button>
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
                    <small class="font-w600 mr-2">${tr('produces')}</small>
                    <span data-tso="chips" class="d-flex flex-wrap align-items-center"></span>
                </div>
                <div class="mt-1">
                    <button type="button" class="btn btn-sm btn-outline-danger" data-tso="broken">
                        <i class="fa fa-tools mr-1"></i>${tr('broken')}<span data-tso="broken-count"></span></button>
                    <button type="button" class="btn btn-sm btn-outline-secondary d-none" data-tso="reset">${tr('resetFilters')}</button>
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
        ui.grid = createElement('div', { className: `${tsTown.className} tso-grid` });
        ui.gridWrap = createElement('div', { className: 'col-12 px-0 d-none' });
        ui.gridWrap.append(ui.grid);
        ui.grid.onclick = (e) => {
            const t = township();
            const open = e.target.closest('[data-tso-open]');
            if (open) {
                const biome = t.biomes.getObjectByID(open.dataset.tsoOpen);
                if (biome) openBiome(biome);
                return;
            }
            const repairAll = e.target.closest('[data-tso-repair-all]');
            if (repairAll) {
                const biome = t.biomes.getObjectByID(repairAll.dataset.tsoRepairAll);
                if (biome) inBiome(biome, (tw) => tw.repairAllBuildingsInCurrentBiome());
            }
        };

        const filterRow = createElement('div', { className: 'row no-gutters' });
        filterRow.append(filterBar);
        tsTown.before(filterRow);
        tsTown.append(ui.gridWrap);

        // Игровой ряд «Починить все в биоме» (не трогаем общий «Починить все»)
        const biomeCosts = document.getElementById('TOWN_REPAIR_ALL_BIOME_COSTS');
        const biomeRow = biomeCosts && biomeCosts.parentElement;
        if (biomeRow && !biomeRow.contains(document.getElementById('TOWN_REPAIR_ALL_COSTS'))) ui.biomeRepairRow = biomeRow;

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
        else if (!el.classList.contains('d-none')) applyActions(el, building, biome);
    });

    // Смена количества для постройки (1 / 5 / … / Макс) — пересчитать цены в сетке
    ctx.patch(TownshipUI, 'setUpgradeQty').after(() => {
        if (initialized && useGrid()) scheduleRender();
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
