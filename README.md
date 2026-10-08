# Township Overview

A quality-of-life mod for the Township screen in Melvor Idle v1.3.1 (works with all expansions: TotH, AoD, ItA).
The interface follows the game language: Russian for `ru`, English for everything else.

[Русская версия ниже](#русский)

## Features

- **Multi-select biomes.** Toggle **Multi-select** above the biome list, then click biomes to add or remove them. **All** / **Clear** select every unlocked biome or none.
  - One biome selected → the normal game interface for that biome.
  - Two or more → the game's own building cards for all selected biomes, grouped by biome. Build and repair work directly from this view, and each biome header has **Open biome** and **Repair all in biome** (with cost).
- **"Produces" filter.** Filter buildings by what they provide: population, happiness, education, storage, worship, fortification, soul storage, or any resource. Pick several at once; **All** clears the filter. Works in both the normal view and multi-select.
- **Broken.** Shows only damaged buildings, with a count on the button and a red badge on each biome.
- **Only available actions.** A card shows the green build button if you can build, the yellow repair button if it is damaged (next to the build button when both apply), or no buttons at all.

Settings are saved per character.

## Install for development (Creator Toolkit)

1. Subscribe to [Creator Toolkit](https://mod.io/g/melvoridle/m/creator-toolkit), then restart the game.
2. Open Creator Toolkit → **Local Mods** and add a local mod:
   - **Steam:** *Directory Link* mode, pick this folder (`.modignore` keeps `.git` and docs out of the package).
   - **Browser:** *Modfile* mode, using a zip with `manifest.json`, `setup.mjs`, `styles.css` at its root.
3. Press **Reload**.

> A local mod only saves settings after it is linked to a mod.io page and installed from there by subscription.

## Files

- `manifest.json` — mod manifest
- `setup.mjs` — all logic
- `styles.css` — styles

---

## Русский

Мод для экрана Township в Melvor Idle v1.3.1 (со всеми дополнениями).

- **Мультивыбор биомов.** Кнопка «Мультивыбор» над списком биомов, клик по биому добавляет его или убирает. «Все» / «Сброс» выбирают все открытые биомы или ни одного.
  - Один биом — обычный интерфейс игры.
  - Два и больше — стандартные карточки зданий всех выбранных биомов, сгруппированные по биомам. Строить и чинить можно прямо отсюда, в заголовке биома есть «Открыть биом» и «Починить все в биоме» со стоимостью.
- **Фильтр «Производит».** Население, счастье, образование, хранилище, поклонение, укрепление, хранилище душ или любой ресурс. Можно выбрать несколько; «Все» снимает фильтр.
- **Сломанные.** Только здания с износом; число на кнопке и красный значок на биомах.
- **Только доступные действия.** Зелёная кнопка — если можно строить, жёлтая — если есть износ (рядом с зелёной, если доступно и то, и другое). Если ничего нельзя — кнопок нет.

Настройки сохраняются для каждого персонажа отдельно.
