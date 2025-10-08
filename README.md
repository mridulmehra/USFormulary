
## API Endpoints

### GET `/health`
- Returns `{ success: true, data: { status: "ok" } }` if DB is reachable.
```bash
curl -s http://localhost:3000/health | jq
```

### GET `/api/years`
- Returns an array of available years: `[2018, 2019, 2020, 2021, 2022, 2023]`.
```bash
curl -s http://localhost:3000/api/years | jq
```

### GET `/api/trends`
- Params: `year` (required int), `limit` (optional int, default 50), `offset` (optional int, default 0)
- Returns drug-level metrics for the specified year, ordered by totalClaims desc.
```bash
curl -s "http://localhost:3000/api/trends?year=2023&limit=5&offset=0" | jq
```

### GET `/api/search`
- Params: `drug` (required string), `startYear` (optional int), `endYear` (optional int)
- Returns drug-level metrics across years matching drug (ILIKE), optionally filtered by year range.
- Includes geography fields: `prscrbr_geo_lvl`, `prscrbr_geo_cd`, `prscrbr_geo_desc`.
```bash
# All years
curl -s "http://localhost:3000/api/search?drug=metformin" | jq

# Year range
curl -s "http://localhost:3000/api/search?drug=metformin&startYear=2020&endYear=2023" | jq
```

### GET `/api/national_totals`
- Returns yearly national aggregates (SUM of metrics), ordered by year asc.
```bash
curl -s http://localhost:3000/api/national_totals | jq
```

### GET `/api/geo_detail`
- Params: `year` (required int), `drug` (optional string)
- Returns metrics plus geography identifiers for the given year (and optional drug).
```bash
curl -s "http://localhost:3000/api/geo_detail?year=2023&drug=atorvastatin" | jq
```

### GET `/api/region_detail`
- Params: `level` (required string), `region` (required string), `year` (optional int), `limit` (optional int, default 50), `offset` (optional int, default 0)
- Returns metrics for a specific geographic level and region (with optional year), ordered by totalClaims desc.
```bash
curl -s "http://localhost:3000/api/region_detail?level=State&region=California&year=2023&limit=5" | jq
```

### GET `/api/formulary/lookup`
- Params: `drug_id` (required string), `id_type` (required 'rxcui'|'ndc'), `plan_id` (required string), `contract_id` (optional string)
- Looks up formulary coverage by drug identifier and plan context; joins `plan_info` for `plan_name`. Returns covered rows.
```bash
# By RXCUI
curl -s "http://localhost:3000/api/formulary/lookup?drug_id=617314&id_type=rxcui&plan_id=ABC123" | jq

# By NDC with contract filter
curl -s "http://localhost:3000/api/formulary/lookup?drug_id=00093-7424-10&id_type=ndc&plan_id=ABC123&contract_id=XYZ999" | jq
```

### GET `/api/formulary/search`
- Params (all optional, at least one required):
  - `rxcui` (int), `ndc` (string), `tier` (int), `pa` ('Y'|'N'), `st` ('Y'|'N'), `ql` ('Y'|'N')
  - Pagination: `limit` (default 50), `offset` (default 0)
  - Sorting: `sort_by` one of `formularyId|tierLevel|paRequired|stepTherapyRequired|quantityLimit`, `sort_dir` `ASC|DESC`
- Searches `basic_drugs_formulary` by provided filters.
```bash
# By RXCUI
curl -s "http://localhost:3000/api/formulary/search?rxcui=1551300&limit=5" | jq

# By flags (e.g., prior auth required = Y) and tier
curl -s "http://localhost:3000/api/formulary/search?pa=Y&tier=3&limit=5" | jq

# By NDC
curl -s "http://localhost:3000/api/formulary/search?ndc=00002143380" | jq

# Sorted by formularyId descending
curl -s "http://localhost:3000/api/formulary/search?rxcui=1551300&sort_by=formularyId&sort_dir=DESC&limit=5" | jq
```

## Fields
- `drugName`, `year`, `totalPrescribers`, `totalClaims`, `total30DayFills`, `totalDrugCost`, `totalBeneficiaries`
- Geography fields where applicable: `prscrbr_geo_lvl`, `prscrbr_geo_cd`, `prscrbr_geo_desc`

# USFormulary
