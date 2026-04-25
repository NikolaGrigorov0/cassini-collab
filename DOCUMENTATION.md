# AquaDose — Пълна документация на проекта

> Сателитно-базирана прецизна напоителна система за български и европейски фермери.
> Документът обхваща продукта, архитектурата, базата данни, основните функционалности,
> алгоритмите за изчисляване на водната нужда и плана за развитие.

---

## Съдържание

1. [Какво е приложението](#1-какво-е-приложението)
2. [Архитектура](#2-архитектура)
3. [База данни — таблици и връзки](#3-база-данни)
4. [Основни функционалности](#4-основни-функционалности)
5. [Алгоритми и изчисления](#5-алгоритми-и-изчисления)
6. [Известни проблеми и бъдещи подобрения](#6-известни-проблеми-и-бъдещи-подобрения)

---

## 1. Какво е приложението

**AquaDose** е уеб приложение за прецизно напояване, което казва на фермера
**колко вода, на кой парцел и на коя дата да даде** — без да слага скъпи
датчици в почвата.

### Проблемът

Българските и европейските фермери губят пари по два начина:

- **Преполиване** → излишен ток за помпата + измиване на торовете в дълбочина.
- **Недополиване** → паднал добив, особено в критичните фази (цъфтеж, наливане).

Обикновено решението — почвени датчици — струва 200–500 лв на парцел и
изисква поддръжка. AquaDose ползва **безплатни сателитни данни** (Sentinel-2,
Sentinel-1) и **метеомодели** (ERA5 / Open-Meteo) за да прави същата
преценка от космоса.

### За кого е предназначено

- Земеделски производители с 1–500 ха обработваема земя.
- Кооперации и агрономи, които управляват няколко парцела от различни култури.
- Поддържани култури в момента: **пшеница, царевица, домати, слънчоглед, лозе**.

### Основни функционалности (към момента)

| # | Функция | Накратко |
|---|---|---|
| 1 | **Дигитална карта на парцелите** | Чертаеш полигона на твоите парцели върху сателитна карта. |
| 2 | **Импорт от GeoJSON / KML / Shapefile** | Бърз импорт на съществуващи граници. |
| 3 | **Автоматично попълване на почва** | ISRIC SoilGrids API → тип, pH, FC, WP, AWC. |
| 4 | **Сателитен мониторинг (NDMI / NDVI)** | Sentinel-2 → Sentinel-1 → ERA5 fallback. |
| 5 | **Препоръка „Кога и колко да полея"** | FAO-56 формула + 7-дневна прогноза. |
| 6 | **Дневен воден баланс** | Cron всяка нощ преизчислява батерията на почвата. |
| 7 | **Фенофази (7-8 под-фази на култура)** | Автоматично преминаване по дата на сеитба. |
| 8 | **„Полях днес" + история** | Фермерът отчита поливането с един клик. |
| 9 | **Уведомления при дефицит** | Push известие когато влагата падне под MAD прага. |
| 10 | **Дефицитен планер** | Разпределя ограничено водоснабдяване по приоритет. |
| 11 | **Многоезичен интерфейс** | bg / en / ro / el / tr / de / fr с автодетекция. |
| 12 | **Единици за фермера** | Превод mm → м³ / литри/декар / часове помпа. |

---

## 2. Архитектура

### 2.1 Frontend

| Слой | Технология |
|---|---|
| Framework | **TanStack Start v1** (React 19 + SSR на Cloudflare Worker) |
| Build | **Vite 7** + `@cloudflare/vite-plugin` |
| Routing | TanStack Router (file-based в `src/routes/`) |
| Стилизация | **Tailwind CSS v4** + semantic токени в `src/styles.css` |
| UI компоненти | **shadcn/ui** (Radix Primitives + cva) |
| Карта | **MapLibre GL** + `@mapbox/mapbox-gl-draw` за чертане |
| Геообработка | `@turf/area`, `@tmcw/togeojson`, `shpjs` |
| Графики | **Recharts** |
| Форми | `react-hook-form` + `zod` |
| Иконки | `lucide-react` + емоджи |
| i18n | `i18next` + `react-i18next` (7 езика) |
| Сървърна комуникация | `@supabase/supabase-js` v2 + TanStack Query |

### 2.2 Backend (Lovable Cloud / Supabase)

- **Postgres** база данни с RLS (всички политики са `auth.uid() = user_id`).
- **Auth** — email + password, Google OAuth.
- **Realtime** — push на нови `irrigation_recommendations` и `notifications`.
- **pg_cron** — нощен job в 04:00 UTC, който вика `/api/public/hooks/daily-soil-balance`.
- **Edge route handlers** (TanStack server routes, deploy-нати в Cloudflare Worker):

| Endpoint | За какво |
|---|---|
| `POST /api/fetch-ndmi` | On-demand сателитен анализ при отваряне на парцел. |
| `POST /api/enrich-soil` | Зарежда почвени параметри от ISRIC SoilGrids. |
| `GET  /api/parcel-moisture-raster` | Връща пиксел-карта на влагата за overlay. |
| `POST /api/public/hooks/daily-soil-balance` | Нощен cron — обновява водния баланс. |
| `POST /api/public/hooks/recalc-parcel` | Преизчисление след поливане / валеж. |
| `POST /api/public/hooks/refresh-recommendations` | Бавен преизчислителен job. |

### 2.3 Външни API-та

| API | За какво | Извикване |
|---|---|---|
| **Sentinel Hub Statistics API** | NDMI/NDVI от Sentinel-2 (B04/B08/B11) и SAR proxy от Sentinel-1 (VH/VV) | OAuth2 client-credentials → `services.sentinel-hub.com/api/v1/statistics` |
| **Open-Meteo** | ETo (FAO Penman-Monteith), валежи, температура — текущи + 7 дни напред | `api.open-meteo.com/v1/forecast` |
| **Open-Meteo ERA5 Archive** | Исторически валеж за последните 7 дни | `archive-api.open-meteo.com/v1/era5` |
| **Open-Meteo Reverse Geocoding** | Българско име на най-близкото населено място | `geocoding-api.open-meteo.com/v1/reverse` |
| **ISRIC SoilGrids** | Тип почва, FC, WP, AWC, pH, органичен въглерод | вика се от `api.enrich-soil.ts` |
| **ipapi.co** | Авто-детекция на държава за избор на език | client-side fetch при първо зареждане |
| **Photon (Komoot)** | Търсене на адреси / населени места в приложението | client-side, без API key |

### 2.4 Файлова структура

```
src/
├── routes/                      # TanStack file-based routing
│   ├── __root.tsx               # HTML shell + providers (QueryClient, i18n)
│   ├── index.tsx                # Landing page
│   ├── auth.tsx                 # Login / signup
│   ├── dashboard.tsx            # Главен екран — карта + парцели
│   ├── add-parcel.tsx           # Чертаене на нов парцел
│   ├── demo.tsx                 # Публичен демо режим (без auth)
│   ├── api.fetch-ndmi.ts        # On-demand сателитна заявка
│   ├── api.enrich-soil.ts       # Зарежда SoilGrids данни
│   ├── api.parcel-moisture-raster.ts
│   └── api.public.hooks.*       # Cron-извикваеми webhooks
│
├── components/                  # React компоненти (~50)
│   ├── ParcelMap.tsx            # MapLibre + draw плъгин
│   ├── ParcelDetail.tsx         # Дясна странична панел при избор
│   ├── ParcelEditor.tsx         # Редакция на форма на парцела
│   ├── ParcelImport.tsx         # GeoJSON/KML/SHP импорт
│   ├── PhenophaseTimeline.tsx   # Timeline на фенофазите
│   ├── SoilInfoCard.tsx         # SoilGrids визуализация
│   ├── SoilBalanceChart.tsx     # 30-дневен график на почвения баланс
│   ├── SatelliteDataSection.tsx # Сателитни данни — фермер/технически режим
│   ├── ForecastChart.tsx        # 7-дневна прогноза за поливане
│   ├── WeatherForecast.tsx      # Open-Meteo widget
│   ├── WaterBattery.tsx         # 🔋 батерия на почвата
│   ├── WateringLog.tsx          # „Полях днес" + история
│   ├── QuickIrrigationActions.tsx  # „Вали днес" auto-detect
│   ├── DeficitScheduleView.tsx  # Дефицитен план
│   ├── NotificationsBell.tsx    # Realtime уведомления
│   ├── LanguageSelector.tsx     # 7 езика
│   └── ui/                      # shadcn/ui примитиви
│
├── hooks/
│   ├── useAuth.ts               # Supabase auth обвивка
│   ├── useRealtimeRecommendations.ts
│   ├── useRealtimeNDMI.ts
│   ├── useRealtimeStatus.ts
│   ├── useLocationSearch.ts     # Photon търсачка
│   └── use-mobile.tsx
│
├── lib/                         # Чиста бизнес логика без React
│   ├── soilBalance.ts           # FAO-56 daily water balance
│   ├── deficitPlanner.ts        # Разпределение при ограничен ресурс
│   ├── irrigationCorrection.ts  # NDMI lift след поливане
│   ├── phenophases.ts           # Фенофази + manual override
│   ├── waterUnits.ts            # mm ↔ m³ ↔ литри/дка ↔ часове помпа
│   ├── openMeteo.ts             # client-side weather wrapper
│   ├── weather.ts               # Centroid + reverse geocode
│   ├── parcelImport.ts          # GeoJSON/KML/SHP parser
│   ├── notifications.ts         # Insert wrapper
│   ├── mockData.ts              # Type definitions + demo seed
│   ├── demoData.ts
│   ├── mapStyle.ts              # MapLibre style JSON
│   └── utils.ts                 # cn(), общи helpers
│
├── integrations/
│   ├── agri/fao56.ts            # ⚙️ Сърцето: FAO-56 + сателитен пайплайн
│   ├── supabase/client.ts       # Браузър Supabase клиент (auto-gen)
│   ├── supabase/client.server.ts # Service-role клиент за edge routes
│   ├── supabase/auth-middleware.ts
│   └── lovable/index.ts
│
├── server/
│   └── parcel.functions.ts      # createServerFn handlers
│
├── i18n/index.ts                # i18next setup + auto-detect
├── locales/{bg,en,ro,el,tr,de,fr}.json
├── styles.css                   # Tailwind v4 @theme + tokens
├── router.tsx                   # createRouter() factory
└── routeTree.gen.ts             # Auto-generated, не пипай!

supabase/
├── config.toml
└── migrations/                  # 6 миграции, read-only
```

---

## 3. База данни

11 таблици в `public` schema. Всички имат RLS активиран, повечето с
политика **„user_id = auth.uid()"** или каскадирана версия през parent parcel.

### `parcels` — основна таблица за парцелите

```
id                  UUID  PK   — уникален идентификатор (gen_random_uuid)
user_id             UUID       — собственик (свързан с auth.users)
name                TEXT       — име на парцела
crop_type           TEXT       — wheat | corn | tomatoes | sunflower | vineyard
growth_phase        TEXT       — initial | development | mid | late
geometry            TEXT       — GeoJSON Polygon (stringified)
area_hectares       NUMERIC    — площ в хектари
sowing_date         DATE       — дата на сеитба (за автофенофази)
pump_flow_m3h       NUMERIC    — дебит на помпата в m³/час

-- Soil (попълнено от ISRIC SoilGrids)
soil_type           TEXT       — английски етикет
soil_type_bg        TEXT       — български етикет
soil_type_wrb       TEXT       — WRB класификация
soil_fc_pct         NUMERIC    — Field Capacity (% обем)
soil_wp_pct         NUMERIC    — Wilting Point (% обем)
soil_awc_pct        NUMERIC    — Available Water Capacity (% обем)
soil_clay_pct       NUMERIC    — % глина
soil_silt_pct       NUMERIC    — % тиня
soil_sand_pct       NUMERIC    — % пясък
soil_ph             NUMERIC
soil_organic_carbon NUMERIC
soil_data_raw       JSONB      — raw отговор от ISRIC за дебъг
soil_enriched_at    TIMESTAMPTZ
awc_mm              NUMERIC    — изчислен AWC в mm за root-зоната

-- Топография
slope_deg           NUMERIC
aspect_deg          NUMERIC
elevation_m         NUMERIC

created_at          TIMESTAMPTZ
```

**RLS:** SELECT/INSERT/UPDATE/DELETE — `auth.uid() = user_id`.

---

### `phenophases` — каталог на фенофази (read-only)

```
id                       UUID  PK
crop_type                TEXT       — wheat / corn / tomatoes / sunflower / vineyard
phase_name               TEXT       — напр. „Цъфтеж", „Наливане"
order_index              INTEGER    — пореден номер в култура
typical_duration_days    INTEGER
days_from_sowing_start   INTEGER    — начало на прозореца от сеитба
days_from_sowing_end     INTEGER    — край на прозореца
kc_base                  NUMERIC    — базов FAO-56 коефициент
mad_threshold            NUMERIC    — % допустимо изпускане (по подразбиране 0.5)
is_critical              BOOLEAN    — ако да → жълто/червено уведомление при стрес
description              TEXT
```

**RLS:** SELECT за всички authenticated; INSERT/UPDATE/DELETE — забранени.
По 7-8 реда на култура.

---

### `parcel_growth` — текуща фаза на парцел

```
id                   UUID  PK
parcel_id            UUID  → parcels.id  (UNIQUE — една активна фаза на парцел)
current_phase_id     UUID  → phenophases.id
is_manual_override   BOOLEAN — true ако фермерът е сменил ръчно
manual_override_at   TIMESTAMPTZ
updated_at           TIMESTAMPTZ
```

**RLS:** каскада през `parcels.user_id`.

---

### `crop_growth_log` — дневник на ръст / NDVI

```
id              UUID  PK
parcel_id       UUID  → parcels.id
date            DATE
phase_id        UUID  → phenophases.id
kc_adjusted     NUMERIC   — Kc след корекция по NDVI
ndvi_value      NUMERIC
gdd_cumulative  NUMERIC   — Growing Degree Days (за бъдещо разширение)
notes           TEXT
created_at      TIMESTAMPTZ
```

---

### `ndmi_readings` — сателитни замервания

```
id              UUID  PK
parcel_id       UUID  → parcels.id
ndmi_value      NUMERIC NOT NULL
ndvi_value      NUMERIC NOT NULL
source          TEXT  DEFAULT 'sentinel-2'
data_source     TEXT       — sentinel-2 | sentinel-1-sar | era5-model
confidence_pct  INTEGER    — 65 / 75 / 90 според източника
cloud_coverage  NUMERIC    — % облачност (за S2)
rainfall_mm     NUMERIC    — натрупан валеж за периода
eto_value       NUMERIC    — ETo (mm/ден) от Open-Meteo
recorded_at     TIMESTAMPTZ
```

**RLS:** SELECT/INSERT през собственика на parcel; UPDATE/DELETE забранени
(append-only за historical честност).

---

### `irrigation_recommendations` — последна препоръка

```
id              UUID  PK
parcel_id       UUID  → parcels.id
dose_mm         NUMERIC NOT NULL  — препоръчана седмична доза
status          TEXT  NOT NULL    — green | yellow | red
reason          TEXT  NOT NULL    — човешки текст за фермера
valid_until     TIMESTAMPTZ
forecast_json   JSONB             — масив [{date, dose_mm, status}, ...]
data_source     TEXT
confidence_pct  INTEGER
created_at      TIMESTAMPTZ
```

**RLS:** SELECT/INSERT през собственика. UPDATE/DELETE — забранени.
(Append-only — историята на препоръките не се пренаписва.)

---

### `irrigation_events` — фермерски „Полях днес"

```
id                   UUID  PK
parcel_id            UUID  → parcels.id
user_id              UUID         (попълва се от trigger)
date                 DATE  DEFAULT CURRENT_DATE
irrigated_at         TIMESTAMPTZ
amount_mm            NUMERIC NOT NULL  — реално излято количество
dose_mm              NUMERIC          — оригиналната препоръка
original_dose_mm     NUMERIC
method               TEXT  DEFAULT 'manual'  — manual | rain | drip | sprinkler
ndmi_before          NUMERIC
ndmi_after           NUMERIC          — ndmi_before + lift
status_before        TEXT
status_after         TEXT
soil_moisture_after  NUMERIC
notes                TEXT
undone               BOOLEAN DEFAULT false
undone_at            TIMESTAMPTZ
created_at           TIMESTAMPTZ
```

**Trigger:** `set_irrigation_event_user_id` попълва `user_id` от parcel.
**Trigger:** `trigger_recalc_recommendation` извиква webhook за нова препоръка.

---

### `soil_moisture_daily` — дневен баланс (cron-генериран)

```
id            UUID  PK
parcel_id     UUID  → parcels.id
date          DATE  DEFAULT CURRENT_DATE  — UNIQUE (parcel_id, date)
balance_mm    NUMERIC  — вода в кореновата зона (mm)
rain_mm       NUMERIC  — валеж за деня
et_mm         NUMERIC  — ETc за деня
moisture_pct  NUMERIC  — 0..100 % от AWC
created_at    TIMESTAMPTZ
```

Една нова редица всеки ден за всеки парцел; основа за `SoilBalanceChart`.

---

### `parcel_history` — снапшоти при редакция на форма

```
id            UUID  PK
parcel_id     UUID
changed_by    UUID
old_geometry  TEXT       — GeoJSON преди
new_geometry  TEXT       — GeoJSON след
old_area_ha   NUMERIC
new_area_ha   NUMERIC
changed_at    TIMESTAMPTZ
```

Append-only audit log; UPDATE/DELETE забранени.

---

### `notifications` — inbox на фермера

```
id          UUID  PK
user_id     UUID         — собственик
parcel_id   UUID         — опционална връзка
title       TEXT
body        TEXT
kind        TEXT  DEFAULT 'info'  — info | warning | critical
action_url  TEXT
read_at     TIMESTAMPTZ
created_at  TIMESTAMPTZ
```

**Realtime:** subscribe в `NotificationsBell.tsx`.

---

### `water_deficit_periods` + `deficit_schedules` — дефицитен планер

```
water_deficit_periods
──────────────────────
id                UUID  PK
user_id           UUID
date_from, date_to DATE
available_pct     INTEGER  — % от нормалното количество вода
affected_parcels  UUID[]
notes             TEXT

deficit_schedules
──────────────────────
id                  UUID  PK
deficit_period_id   UUID  → water_deficit_periods.id
parcel_id           UUID  → parcels.id
scheduled_date      DATE
dose_mm             NUMERIC
priority            TEXT     — critical | important | tolerable
crop_stress_risk    TEXT     — low | medium | high | critical
```

RLS на `deficit_schedules` каскадира през `water_deficit_periods.user_id`.

---

### Database functions

- **`set_irrigation_event_user_id()`** — trigger, попълва user_id от parcel.
- **`trigger_recalc_recommendation()`** — trigger след `irrigation_events`,
  POST-ва към `/api/public/hooks/recalc-parcel` за свежа препоръка.

---

## 4. Основни функционалности

### а) Парцели — създаване, редакция, импорт

**Какво вижда фермерът:**
„Add Parcel" → попълва име, култура, дата на сеитба → чертае полигона върху
сателитна карта или импортира GeoJSON/KML/SHP файл.
В `Dashboard` парцелите се показват като списък + цветни полигони.

**Технически:**
- `routes/add-parcel.tsx` — целеви екран с MapLibre + Mapbox Draw.
- `components/ParcelEditor.tsx` — реактивен формуляр (`react-hook-form` + `zod`).
- `components/ParcelImport.tsx` + `lib/parcelImport.ts` — поддържа `.geojson`,
  `.kml`, `.kmz`, `.zip` (Shapefile) чрез `shpjs` и `@tmcw/togeojson`.
- Площта се изчислява локално с `@turf/area`, после се верифицира на сървъра.
- При запис се вика `server/parcel.functions.ts → createServerFn` →
  insert в `parcels` + автоматичен `await fetch('/api/enrich-soil')`.
- При промяна на форма (edit mode): диф между стара и нова геометрия се
  записва в `parcel_history` за audit.

### б) Карта — визуализация и edit mode

- **MapLibre GL** базова карта (style в `lib/mapStyle.ts` — satellite + labels).
- Полигоните се рендерират като отделни fill+line layer-и оцветени по `status`
  (`green` / `yellow` / `red`) от последната препоръка.
- При клик на парцел → `flyTo()` с padding и отваря `ParcelDetail` отдясно.
- **Edit mode** (`@mapbox/mapbox-gl-draw`): drag на върховете → live изчислява
  площта, при Save → диф запис в `parcel_history` + UPDATE `parcels.geometry`.
- Долепен `MapPlaceSearch` (Photon) за прелитане до село/нива по име.

### в) Фенофази — автоматично преминаване

- Каталогът от 7-8 под-фази на култура е seed-нат в `phenophases` (read-only).
- При липса на manual override: `lib/phenophases.ts → pickPhaseForDate()`
  смята `daysSinceSowing = today - sowing_date` и взима фазата чийто
  `[days_from_sowing_start, days_from_sowing_end)` обхваща този ден.
- При manual override: `parcel_growth.is_manual_override = true` и UI заключва
  до изтичане на фазата.
- `components/PhenophaseTimeline.tsx` — хоризонтална timeline лента; cropType
  е в dependency array на useEffect (важно — иначе кешираните фази от
  предишен парцел остават при превключване).

### г) Почвени данни (ISRIC SoilGrids)

- **Когато:** еднократно при създаване на парцел или при ръчен retry.
- **Поток:**
  1. `POST /api/enrich-soil` с `parcel_id` + centroid.
  2. Server route вика [SoilGrids REST API](https://rest.isric.org/soilgrids/v2.0/properties/query)
     за дълбочини 0–30 cm и слоеве `phh2o`, `ocd`, `clay`, `silt`, `sand`, `bdod`.
  3. Извежда `FC`, `WP`, `AWC` чрез pedo-transfer уравнения.
  4. Извежда български превод на типа на почвата (`soil_type_bg`) от WRB кода.
  5. UPDATE `parcels` + raw JSON в `soil_data_raw` за дебъг.
- **UI:** `SoilInfoCard.tsx` показва тип, FC/WP/AWC, pH, органичен въглерод;
  ако enrichment-ът е failnal — бутон „Опитай отново".

### д) Прогноза за времето

- **Open-Meteo Forecast API** — 7 дни напред: ETo (Penman-Monteith), валежи,
  средна температура. Без API ключ.
- **ERA5 Archive API** — 7 дни назад за същите променливи.
- `WeatherForecast.tsx` показва иконки за всеки от 7-те дни; стойностите
  директно влизат в `computeRecommendation()` за дневния dose.
- `lib/weather.ts → getRainForGeometry()` се ползва от „Вали днес" — auto-detect
  на днешния валеж за центъра на парцела + reverse geocode на най-близкото село.

### е) Напояване — изчисляване и „Полях днес"

- **Изчисление** (виж секция 5): `dose_mm = mean(ETo) × Kc × 7 × m(NDMI)`.
- **UI:** `QuickIrrigationActions` + `WateringLog` показват препоръчаната доза
  в **mm**, **m³ за парцела** и **часове помпа** (използва `pump_flow_m3h`).
- **„Полях днес"** бутон → `WateringLog` отваря диалог с pre-filled количество
  → INSERT в `irrigation_events` → trigger в DB вика webhook за recalc →
  Realtime push на нова препоръка → UI се обновява без презареждане.
- **„Вали днес"** бутон → авто-чете днешния валеж от Open-Meteo → INSERT
  с `method = "rain"` → същият recalc цикъл.
- **Undo** — поставя `undone = true`, recalc игнорира тези записи.

### ж) Търсачка (парцели + населени места)

- **Парцели:** `LocationSearchBar` — local-only fuzzy match по `parcels.name`
  и тип на културата.
- **Места:** `MapPlaceSearch` + `useLocationSearch.ts` — извиква Photon API
  (`photon.komoot.io`), debounce-ва на 250 ms. При избор → MapLibre `flyTo`.

### з) Автоматичен език

- `i18n/index.ts → pickInitialLanguage()` чете първо `localStorage` →
  после `navigator.language` → fallback `en`.
- В background `autoDetectByGeolocation()` пита `ipapi.co` за държава и
  мапва (BG→bg, RO→ro, GR/CY→el, TR→tr, DE/AT/CH→de, FR/BE/LU→fr).
- Ако фермерът ръчно е избрал език (има го в localStorage) — geo-детекция
  се пропуска.
- Поддържани: 🇧🇬 🇬🇧 🇷🇴 🇬🇷 🇹🇷 🇩🇪 🇫🇷 (7 езика, всичко в `src/locales/*.json`).
- Числата и датите се форматират чрез `Intl.NumberFormat` / `Intl.DateTimeFormat`
  с активния локал.

---

## 5. Алгоритми и изчисления

### 5.1 Дневен воден баланс (FAO-56)

Файл: `src/lib/soilBalance.ts`

Кореновата зона се моделира като „батерия" с капацитет `AWC_mm`:

```
balance_mm[t] = clamp( balance_mm[t-1] + rain + irrigation − ETc , 0, AWC )
moisture_pct  = 100 × balance_mm / AWC
depleted_pct  = 100 − moisture_pct
```

където `ETc = ETo × Kc`. Всеки ден в 04:00 UTC nightly cron минава през
всички парцели и записва нова редица в `soil_moisture_daily`.

### 5.2 Kc коефициент + NDVI корекция

Файл: `src/integrations/agri/fao56.ts`

- **Базов Kc** идва от таблица по култура × фаза:

  | Култура | initial | development | mid | late |
  |---|---|---|---|---|
  | wheat | 0.40 | 0.70 | 1.15 | 0.40 |
  | corn | 0.30 | 0.70 | 1.20 | 0.60 |
  | tomatoes | 0.60 | 0.85 | 1.15 | 0.80 |
  | sunflower | 0.35 | 0.75 | 1.10 | 0.50 |
  | vineyard | 0.30 | 0.55 | 0.80 | 0.45 |

- **NDVI корекция** (бъдеща fine-tuning точка): `Kc_adj = Kc × clamp(NDVI/0.6, 0.5, 1.2)`.
  В момента се записва в `crop_growth_log.kc_adjusted` за дебъг, но самият
  recommendation engine ползва базовия Kc.

### 5.3 NDMI multiplier — колко спешно е поливането

```
NDMI > 0.30   → m = 0.0   (зелено, без полив)
0.20 < ≤ 0.30 → m = 0.4   (близо до прага)
0.00 < ≤ 0.20 → m = 0.7   (жълто, умерено)
NDMI ≤ 0.00   → m = 1.0   (червено, спешно)
```

### 5.4 MAD праг (Management Allowed Depletion)

- Всяка фенофаза има собствен `mad_threshold` (по подразбиране 0.5).
- В критични фази (цъфтеж, наливане) — обикновено 0.4 (по-стриктно).
- Логика: `isBelowMad = moisturePct < (1 − madThreshold) × 100`.
- При преминаване под прага → INSERT уведомление + recompute препоръка.

### 5.5 Седмична препоръка

```
meanEto    = средно ETo за следващите 7 дни (Open-Meteo)
weeklyDose = round( meanEto × Kc × 7 × m(NDMI) )   [mm/седмица]
```

За всеки от 7-те дни се смята и **дневна доза**:
```
ETc_day  = ETo_day × Kc
dose_day = max(0, round( ETc_day × m − rain_day ))
```
(Тежък дъжд → dose_day = 0, статусът се вдига от червено към жълто/зелено.)

### 5.6 Преобразуване mm → разбираеми единици

Файл: `src/lib/waterUnits.ts`

```
1 ха       = 10 декара
1 mm на декар (1000 m²) = 1000 L = 1 m³

litersPerDka = mm × 1000
m3PerDka     = mm
totalM3      = mm × area_ha × 10
totalLiters  = totalM3 × 1000

pumpHours    = totalM3 / pump_flow_m3h
```

`formatHours()` връща `"2 ч 30 мин"` за фермерски четим текст.

### 5.7 NDMI lift след поливане

Файл: `src/lib/irrigationCorrection.ts`

Емпирично правило: всеки 10 mm полив вдига NDMI с **+0.06**, capped на 0.45
(приблизително field capacity за повечето почви). Soil multiplier:

| Почва | Множител | Защо |
|---|---|---|
| Песъчлива | 0.80 | бързо източване, по-малко задържана вода |
| Льос | 1.05 | средно |
| Смесена | 1.05 | средно |
| Глинеста | 1.20 | задържа много, голям lift |
| Други / loam | 1.00 | базово |

След lift-а — нова статус кофа + дни до следващ check (3 / 5 / 7 дни според
зеления / жълтия / червения статус).

### 5.8 Многоизточников сателитен пайплайн

Файл: `src/integrations/agri/fao56.ts → runPipeline()`

Приоритетен ред:

1. **Sentinel-2 L2A** (`fetchSentinel2`) — оптика, 10 m, 5 дни revisit.
   Bands B04 (червено), B08 (NIR), B11 (SWIR), плюс SCL за облачност.
   - `NDVI = (B08 − B04) / (B08 + B04)`
   - `NDMI = (B08 − B11) / (B08 + B11)`
   - Прието ако `cloudCoverage < 30%` → confidence **90%**.

2. **Sentinel-1 SAR** (`fetchSentinel1Sar`) — радар, работи през облаци.
   - `VH/VV` ratio нормализиран към `[-1, 1]` като NDMI proxy.
   - confidence **75%**.

3. **ERA5 / Open-Meteo fallback** (`estimateNdmiFromRain`) — модел.
   - `NDMI ≈ min(rainfall_mm / 50 − 0.2, 0.4)`
   - confidence **65%**.

Резултатът + източникът се записва в `ndmi_readings` (за history) и
`irrigation_recommendations` (за UI).

### 5.9 Дефицитен планер

Файл: `src/lib/deficitPlanner.ts`

Когато фермерът декларира период с ограничено количество вода
(`water_deficit_periods.available_pct = 60`):

1. За всеки парцел се изчислява **priority** (critical/important/tolerable)
   според култура × фенофаза.
2. Изчислява се **stress risk** (critical/high/medium/low).
3. Парцелите се сортират по `(priority, stress)`.
4. Наличната вода се разпределя първо на критичните; останалите получават
   намалена доза (с оценка за % загуба на добив).
5. Резултатът се записва в `deficit_schedules` и UI го показва като
   календар на следващите 7 дни.

---

## 6. Известни проблеми и бъдещи подобрения

### 6.1 TODO коментари в кода

Прегледът на src/ **не върна нито един explicit TODO/FIXME/XXX/HACK** маркер.
Кодът е чист откъм todo-та. Има обаче няколко **имплицитни** места:

- **`i18n/index.ts:12`** — RTL езиците (ar, he) са спрени с коментар
  „RTL support — not implemented yet".
- **`irrigationCorrection.ts:43`** — параметрите `_cropType` и `_growthPhase`
  се приемат но не се ползват (placeholder за бъдеща FAO-56 fine-tuning).
- **`crop_growth_log.gdd_cumulative`** — колоната съществува, но Growing
  Degree Days още не се изчисляват автоматично.
- **`parcels.slope_deg / aspect_deg / elevation_m`** — колоните са
  попълнени, но не влияят на dose изчислението (placeholder).

### 6.2 Архитектурни ограничения

- **Edge Worker лимити** — Sentinel Hub queries за статистика отнемат
  1-3 s; при много паралелни заявки може да удари timeout-а на Worker (30 s).
  Решение: вече имаме nightly cron, който prefetch-ва всички парцели.
- **Кеш на phenophases** — `_cache` в `lib/phenophases.ts` е module-level
  → споделя се между requests в Worker. Ако се добавят нови фази в DB
  трябва restart на Worker. Не е проблем за production, но deploy след
  миграция е нужен.
- **NDMI lift формулата** е емпирична — точността зависи от тип почва.
  Има място за фини настройки чрез ML по `irrigation_events.ndmi_before/after`.

### 6.3 Предложения за следващи стъпки

**Краткосрочни (1-2 седмици):**

1. **NDVI-driven Kc adjustment** — да заработи реално, не само да се записва.
2. **Известия в Telegram / Viber bot** — текущите notifications са само in-app.
3. **PDF / CSV експорт** на история на поливането (за земеделски справки).
4. **„Сравни с миналата седмица" widget** — спестена вода спрямо традиционен график.
5. **Гласови известия** — TTS на български („Полей утре домати, 25 mm").

**Средносрочни (1-2 месеца):**

6. **Multi-zone parcels** — голям парцел с различни нужди в различни ъгли
   (вече има `api.parcel-moisture-raster` — нужен е UI за zone management).
7. **Soil moisture sensor integration** (опционален) — за калибровка на
   модела при фермери, които вече имат датчици.
8. **Финансова оценка** — въвеждане на цена на ток + вода → лева спестени.
9. **Поддръжка на нови култури** — пипер, краставици, тютюн, череши.
10. **Сравнение с регионален benchmark** — „средно за региона за тази култура".

**Дългосрочни:**

11. **Yield prediction** — комбинация от GDD + NDVI + полета за добив.
12. **Marketplace / Cooperative mode** — фермерски кооперативи с общо водоснабдяване.
13. **Mobile app** (React Native / Capacitor) — текущото е responsive web,
    но native push нотификации ще са по-надеждни.
14. **Carbon credits dashboard** — спестена вода → CO₂ еквивалент → потенциална монетизация.

---

## Приложение А — Environment variables

| Име | За какво | Локация |
|---|---|---|
| `VITE_SUPABASE_URL` | Браузър клиент | `.env` (auto) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key за client | `.env` (auto) |
| `SUPABASE_URL` | Server-side | secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin | secret |
| `SUPABASE_DB_URL` | Cron / migrations | secret |
| `SENTINEL_HUB_CLIENT_ID` | Sentinel Hub OAuth | secret |
| `SENTINEL_HUB_CLIENT_SECRET` | Sentinel Hub OAuth | secret |
| `LOVABLE_API_KEY` | (запазен — Lovable AI Gateway) | secret |

## Приложение Б — Полезни линкове

- **FAO Irrigation and Drainage Paper 56** — основа за всички формули в проекта.
- **Sentinel Hub Statistics API docs** — https://docs.sentinel-hub.com/api/latest/api/statistical/
- **Open-Meteo API docs** — https://open-meteo.com/en/docs
- **ISRIC SoilGrids REST** — https://www.isric.org/explore/soilgrids/soilgrids-access
- **TanStack Start docs** — https://tanstack.com/start
- **MapLibre GL JS docs** — https://maplibre.org/maplibre-gl-js/docs/

---

*Последно обновено: 2026-04-25 · Версия на схемата: 6 миграции · Брой компоненти: ~50*
*Документацията е автогенерирана от анализ на актуалния код. При значими*
*промени по архитектурата — моля, обновете и този файл.*
