'use strict';

const express = require('express');
const { Pool } = require('pg');

const app = express();

// Database configuration with env overrides
const DB_CONFIG = {
  host: process.env.PGHOST || 'srmist.cjwqmm4a21xa.ap-south-1.rds.amazonaws.com',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'srmist_fl',
  password: process.env.PGPASSWORD || 'w8Qn3bZ2vR1xLt0p',
  database: process.env.PGDATABASE || 'srmist_fl_db',
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 10000),
  // Force SSL for RDS; allow env to disable explicitly with PGSSLMODE=disable
  ssl: process.env.PGSSLMODE === 'disable' ? undefined : { rejectUnauthorized: false },
};

const pool = new Pool(DB_CONFIG);

pool.on('error', (err) => {
  // Log idle client errors
  console.error('Unexpected error on idle client', err);
});

// Helpers for consistent responses
function successResponse(res, data, statusCode = 200, extra) {
  const payload = { success: true, data, ...(extra || {}) };
  return res.status(statusCode).json(payload);
}

function errorResponse(res, message, statusCode = 500, details) {
  const payload = { success: false, error: message };
  if (details) payload.details = details;
  return res.status(statusCode).json(payload);
}

// Pagination helper: parses limit/offset with defaults and validation
function parsePagination(query) {
  const limitRaw = query.limit;
  const offsetRaw = query.offset;
  const limit = limitRaw == null ? 50 : Number(limitRaw);
  const offset = offsetRaw == null ? 0 : Number(offsetRaw);
  if (!Number.isInteger(limit) || !Number.isInteger(offset)) {
    const err = new Error("Parameters 'limit' and 'offset' must be integers");
    err.statusCode = 400;
    throw err;
  }
  return { limit, offset };
}

// Health endpoint
app.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT 1');
    return successResponse(res, { status: 'ok' });
  } catch (err) {
    return errorResponse(res, 'Database unavailable', 503, String(err));
  }
});

// 1) Primary Trends Endpoint (Required Year Filter)
app.get('/api/trends', async (req, res) => {
  const { year: yearParam } = req.query;

  if (yearParam == null) {
    return errorResponse(res, 'Missing required parameter: year', 400);
  }

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return errorResponse(res, "Parameter 'year' must be an integer", 400);
  }

  let limit, offset;
  try {
    ({ limit, offset } = parsePagination(req.query));
  } catch (e) {
    const status = e && e.statusCode ? e.statusCode : 400;
    return errorResponse(res, e.message || 'Invalid pagination parameters', status);
  }

  const sql = `
    SELECT year,
           COALESCE(brnd_name, gnrc_name) AS drug_name,
           tot_prscrbrs,
           tot_clms,
           tot_30day_fills,
           tot_drug_cst,
           tot_benes
    FROM prescribers_by_geography_drug
    WHERE year = $1
    ORDER BY tot_clms DESC
    LIMIT $2 OFFSET $3
  `;

  try {
    const { rows } = await pool.query(sql, [year, limit, offset]);
    const data = rows.map((r) => ({
      drugName: r.drug_name,
      year: r.year,
      totalPrescribers: r.tot_prscrbrs,
      totalClaims: r.tot_clms,
      total30DayFills: r.tot_30day_fills,
      totalDrugCost: r.tot_drug_cst,
      totalBeneficiaries: r.tot_benes,
    }));
    return successResponse(res, data, 200, { limit, offset, count: data.length });
  } catch (err) {
    return errorResponse(res, 'Database error while fetching trends', 500, String(err));
  }
});

// 2) Search by Drug Name (Across All Years)
app.get('/api/search', async (req, res) => {
  const { drug } = req.query;
  if (!drug) {
    return errorResponse(res, 'Missing required parameter: drug', 400);
  }

  // Validate optional year range
  const { startYear: startYearRaw, endYear: endYearRaw } = req.query;
  let startYear, endYear;
  if (startYearRaw != null && startYearRaw !== '') {
    startYear = Number(startYearRaw);
    if (!Number.isInteger(startYear)) {
      return errorResponse(res, "Parameter 'startYear' must be an integer", 400);
    }
  }
  if (endYearRaw != null && endYearRaw !== '') {
    endYear = Number(endYearRaw);
    if (!Number.isInteger(endYear)) {
      return errorResponse(res, "Parameter 'endYear' must be an integer", 400);
    }
  }

  // Dynamic WHERE clauses with parameter counter
  const whereClauses = [];
  const params = [];
  let p = 1;
  const pattern = `%${drug}%`;
  whereClauses.push(`(brnd_name ILIKE $${p} OR gnrc_name ILIKE $${p})`);
  params.push(pattern);
  p += 1;
  if (startYear != null) {
    whereClauses.push(`year >= $${p}`);
    params.push(startYear);
    p += 1;
  }
  if (endYear != null) {
    whereClauses.push(`year <= $${p}`);
    params.push(endYear);
    p += 1;
  }

  const sql = `
    SELECT year,
           COALESCE(brnd_name, gnrc_name) AS drug_name,
           tot_prscrbrs,
           tot_clms,
           tot_30day_fills,
           tot_drug_cst,
           tot_benes,
           prscrbr_geo_lvl,
           prscrbr_geo_cd,
           prscrbr_geo_desc
    FROM prescribers_by_geography_drug
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY year DESC, tot_clms DESC
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const data = rows.map((r) => ({
      drugName: r.drug_name,
      year: r.year,
      totalPrescribers: r.tot_prscrbrs,
      totalClaims: r.tot_clms,
      total30DayFills: r.tot_30day_fills,
      totalDrugCost: r.tot_drug_cst,
      totalBeneficiaries: r.tot_benes,
      prscrbr_geo_lvl: r.prscrbr_geo_lvl,
      prscrbr_geo_cd: r.prscrbr_geo_cd,
      prscrbr_geo_desc: r.prscrbr_geo_desc,
    }));
    return successResponse(res, data, 200, { count: data.length });
  } catch (err) {
    return errorResponse(res, 'Database error while searching by drug', 500, String(err));
  }
});

// 4) National Aggregates (Time Series)
app.get('/api/national_totals', async (req, res) => {
  const sql = `
    SELECT year,
           SUM(tot_prscrbrs) AS total_prescribers,
           SUM(tot_clms) AS total_claims,
           SUM(tot_30day_fills) AS total_30day_fills,
           SUM(tot_drug_cst) AS total_drug_cost,
           SUM(tot_benes) AS total_beneficiaries
    FROM prescribers_by_geography_drug
    GROUP BY year
    ORDER BY year ASC
  `;
  try {
    const { rows } = await pool.query(sql);
    const data = rows.map((r) => ({
      year: r.year,
      totalPrescribers: r.total_prescribers,
      totalClaims: r.total_claims,
      total30DayFills: r.total_30day_fills,
      totalDrugCost: r.total_drug_cost,
      totalBeneficiaries: r.total_beneficiaries,
    }));
    return successResponse(res, data, 200, { count: data.length });
  } catch (err) {
    return errorResponse(res, 'Database error while fetching national totals', 500, String(err));
  }
});

// 5) Geographic Detail
app.get('/api/geo_detail', async (req, res) => {
  const { year: yearParam, drug } = req.query;
  if (yearParam == null) {
    return errorResponse(res, 'Missing required parameter: year', 400);
  }
  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return errorResponse(res, "Parameter 'year' must be an integer", 400);
  }

  // Build dynamic filters: required year, optional drug pattern on brand/generic
  const whereClauses = ['year = $1'];
  const params = [year];
  let p = 2;
  if (drug) {
    whereClauses.push(`(brnd_name ILIKE $${p} OR gnrc_name ILIKE $${p})`);
    params.push(`%${drug}%`);
    p += 1;
  }

  const sql = `
    SELECT year,
           COALESCE(brnd_name, gnrc_name) AS drug_name,
           tot_prscrbrs,
           tot_clms,
           tot_30day_fills,
           tot_drug_cst,
           tot_benes,
           prscrbr_geo_lvl,
           prscrbr_geo_cd,
           prscrbr_geo_desc
    FROM prescribers_by_geography_drug
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY prscrbr_geo_lvl ASC, prscrbr_geo_cd ASC, tot_clms DESC
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const data = rows.map((r) => ({
      drugName: r.drug_name,
      year: r.year,
      totalPrescribers: r.tot_prscrbrs,
      totalClaims: r.tot_clms,
      total30DayFills: r.tot_30day_fills,
      totalDrugCost: r.tot_drug_cst,
      totalBeneficiaries: r.tot_benes,
      prscrbr_geo_lvl: r.prscrbr_geo_lvl,
      prscrbr_geo_cd: r.prscrbr_geo_cd,
      prscrbr_geo_desc: r.prscrbr_geo_desc,
    }));
    return successResponse(res, data, 200, { count: data.length });
  } catch (err) {
    return errorResponse(res, 'Database error while fetching geographic detail', 500, String(err));
  }
});

// 6) Region detail by geographic level and description
app.get('/api/region_detail', async (req, res) => {
  const { level, region, year: yearParam } = req.query;

  // Validate required params
  if (!level || typeof level !== 'string' || level.trim() === '') {
    return errorResponse(res, "Missing or invalid required parameter: level", 400);
  }
  if (!region || typeof region !== 'string' || region.trim() === '') {
    return errorResponse(res, "Missing or invalid required parameter: region", 400);
  }

  // Validate optional year
  let year;
  if (yearParam != null && yearParam !== '') {
    year = Number(yearParam);
    if (!Number.isInteger(year)) {
      return errorResponse(res, "Parameter 'year' must be an integer", 400);
    }
  }

  // Pagination
  let limit, offset;
  try {
    ({ limit, offset } = parsePagination(req.query));
  } catch (e) {
    const status = e && e.statusCode ? e.statusCode : 400;
    return errorResponse(res, e.message || 'Invalid pagination parameters', status);
  }

  // Dynamic WHERE clauses with parameter counter
  const whereClauses = [];
  const params = [];
  let p = 1;

  whereClauses.push(`prscrbr_geo_lvl = $${p}`); params.push(level); p += 1;
  whereClauses.push(`prscrbr_geo_desc = $${p}`); params.push(region); p += 1;

  if (year != null) {
    whereClauses.push(`year = $${p}`);
    params.push(year);
    p += 1;
  }

  // Add pagination params
  params.push(limit, offset);

  const sql = `
    SELECT year,
           COALESCE(brnd_name, gnrc_name) AS drug_name,
           tot_prscrbrs,
           tot_clms,
           tot_30day_fills,
           tot_drug_cst,
           tot_benes,
           prscrbr_geo_lvl,
           prscrbr_geo_cd,
           prscrbr_geo_desc
    FROM prescribers_by_geography_drug
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY tot_clms DESC
    LIMIT $${p} OFFSET $${p + 1}
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const data = rows.map((r) => ({
      drugName: r.drug_name,
      year: r.year,
      totalPrescribers: r.tot_prscrbrs,
      totalClaims: r.tot_clms,
      total30DayFills: r.tot_30day_fills,
      totalDrugCost: r.tot_drug_cst,
      totalBeneficiaries: r.tot_benes,
      prscrbr_geo_lvl: r.prscrbr_geo_lvl,
      prscrbr_geo_cd: r.prscrbr_geo_cd,
      prscrbr_geo_desc: r.prscrbr_geo_desc,
    }));
    return successResponse(res, data, 200, { limit, offset, count: data.length });
  } catch (err) {
    return errorResponse(res, 'Database error while fetching region detail', 500, String(err));
  }
});

// 7) Formulary lookup by drug identifier and plan context
app.get('/api/formulary/lookup', async (req, res) => {
  const { drug_id: drugId, id_type: idTypeRaw, plan_id: planId, contract_id: contractId } = req.query;

  // Validate required parameters
  if (!drugId || typeof drugId !== 'string' || drugId.trim() === '') {
    return errorResponse(res, "Missing or invalid required parameter: drug_id", 400);
  }
  if (!idTypeRaw || typeof idTypeRaw !== 'string') {
    return errorResponse(res, "Missing or invalid required parameter: id_type", 400);
  }
  const idType = idTypeRaw.toLowerCase();
  if (idType !== 'rxcui' && idType !== 'ndc') {
    return errorResponse(res, "Parameter 'id_type' must be either 'rxcui' or 'ndc'", 400);
  }
  if (!planId || typeof planId !== 'string' || planId.trim() === '') {
    return errorResponse(res, "Missing or invalid required parameter: plan_id", 400);
  }

  // Build dynamic filters with parameterized query
  const whereClauses = [];
  const params = [];
  let p = 1;

  // Join to plan_info for plan_name and plan identifiers
  // Drug identifier filter (type-based)
  if (idType === 'rxcui') {
    const rxcuiVal = Number(drugId);
    if (!Number.isInteger(rxcuiVal)) {
      return errorResponse(res, "Parameter 'drug_id' must be an integer when id_type='rxcui'", 400);
    }
    whereClauses.push(`bf.rxcui = $${p}`);
    params.push(rxcuiVal);
    p += 1;
  } else {
    // ndc is stored as varchar(20)
    whereClauses.push(`bf.ndc = $${p}`);
    params.push(String(drugId));
    p += 1;
  }

  // Required plan context: allow matching by plan_id OR formulary_id (some callers may pass formulary_id)
  whereClauses.push(`(pi.plan_id = $${p} OR pi.formulary_id = $${p})`);
  params.push(planId);
  p += 1;

  // Optional contract filter
  if (contractId && String(contractId).trim() !== '') {
    whereClauses.push(`pi.contract_id = $${p}`);
    params.push(contractId);
    p += 1;
  }

  const sql = `
    SELECT
      bf.formulary_id,
      bf.rxcui,
      bf.ndc,
      pi.plan_id AS plan_id,
      pi.contract_id AS contract_id,
      pi.plan_name AS plan_name,
      bf.tier_level_value,
      bf.prior_authorization_yn,
      bf.step_therapy_yn,
      bf.quantity_limit_yn
    FROM basic_drugs_formulary bf
    INNER JOIN plan_info pi ON pi.formulary_id = bf.formulary_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY bf.tier_level_value ASC, bf.ndc ASC
  `;

  try {
    const { rows } = await pool.query(sql, params);
    if (!rows || rows.length === 0) {
      // 404 with empty array per spec intent
      return successResponse(res, [], 404, { count: 0 });
    }
    const data = rows.map((r) => ({
      formularyId: r.formulary_id,
      rxcui: r.rxcui,
      ndc: r.ndc,
      planId: r.plan_id,
      contractId: r.contract_id,
      planName: r.plan_name,
      tierLevel: r.tier_level_value,
      paRequired: r.prior_authorization_yn,
      stepTherapyRequired: r.step_therapy_yn,
      quantityLimit: r.quantity_limit_yn,
      coveredStatus: 'Covered',
    }));
    return successResponse(res, data, 200, { count: data.length });
  } catch (err) {
    return errorResponse(res, 'Database error while performing formulary lookup', 500, String(err));
  }
});

// 8) Formulary search with dynamic filters (rxcui, ndc, tier, flags)
app.get('/api/formulary/search', async (req, res) => {
  const { rxcui: rxcuiRaw, ndc, tier: tierRaw, pa: paRaw, st: stRaw, ql: qlRaw, sort_by: sortByRaw, sort_dir: sortDirRaw } = req.query;

  // Validate optional numeric filters
  let rxcui, tier;
  if (rxcuiRaw != null && rxcuiRaw !== '') {
    rxcui = Number(rxcuiRaw);
    if (!Number.isInteger(rxcui)) {
      return errorResponse(res, "Parameter 'rxcui' must be an integer", 400);
    }
  }
  if (tierRaw != null && tierRaw !== '') {
    tier = Number(tierRaw);
    if (!Number.isInteger(tier)) {
      return errorResponse(res, "Parameter 'tier' must be an integer", 400);
    }
  }

  // Validate optional flag filters (expect 'Y' or 'N')
  const validFlag = (v) => v === 'Y' || v === 'N';
  const pa = paRaw != null && paRaw !== '' ? String(paRaw).toUpperCase() : undefined;
  const st = stRaw != null && stRaw !== '' ? String(stRaw).toUpperCase() : undefined;
  const ql = qlRaw != null && qlRaw !== '' ? String(qlRaw).toUpperCase() : undefined;
  if (pa && !validFlag(pa)) return errorResponse(res, "Parameter 'pa' must be 'Y' or 'N'", 400);
  if (st && !validFlag(st)) return errorResponse(res, "Parameter 'st' must be 'Y' or 'N'", 400);
  if (ql && !validFlag(ql)) return errorResponse(res, "Parameter 'ql' must be 'Y' or 'N'", 400);

  // Pagination
  let limit, offset;
  try {
    ({ limit, offset } = parsePagination(req.query));
  } catch (e) {
    const status = e && e.statusCode ? e.statusCode : 400;
    return errorResponse(res, e.message || 'Invalid pagination parameters', status);
  }

  // Dynamic WHERE clauses
  const whereClauses = [];
  const params = [];
  let p = 1;
  if (rxcui != null) { whereClauses.push(`bf.rxcui = $${p}`); params.push(rxcui); p += 1; }
  if (ndc != null && ndc !== '') { whereClauses.push(`bf.ndc = $${p}`); params.push(String(ndc)); p += 1; }
  if (tier != null) { whereClauses.push(`bf.tier_level_value = $${p}`); params.push(tier); p += 1; }
  if (pa) { whereClauses.push(`bf.prior_authorization_yn = $${p}`); params.push(pa); p += 1; }
  if (st) { whereClauses.push(`bf.step_therapy_yn = $${p}`); params.push(st); p += 1; }
  if (ql) { whereClauses.push(`bf.quantity_limit_yn = $${p}`); params.push(ql); p += 1; }

  // If no filters provided, prevent full table scan: require at least one filter
  if (whereClauses.length === 0) {
    return errorResponse(res, 'Provide at least one filter: rxcui, ndc, tier, pa, st, or ql', 400);
  }

  // Sorting (whitelist)
  const sortColumnMap = {
    formularyId: 'bf.formulary_id',
    tierLevel: 'bf.tier_level_value',
    paRequired: 'bf.prior_authorization_yn',
    stepTherapyRequired: 'bf.step_therapy_yn',
    quantityLimit: 'bf.quantity_limit_yn',
  };
  const sortBy = sortByRaw && sortColumnMap[sortByRaw] ? sortColumnMap[sortByRaw] : 'bf.tier_level_value';
  const sortDir = String(sortDirRaw || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  // Add pagination placeholders
  params.push(limit, offset);

  const sql = `
    SELECT
      bf.formulary_id,
      bf.rxcui,
      bf.ndc,
      bf.tier_level_value,
      bf.prior_authorization_yn,
      bf.step_therapy_yn,
      bf.quantity_limit_yn
    FROM basic_drugs_formulary bf
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY ${sortBy} ${sortDir}, bf.ndc ASC
    LIMIT $${p} OFFSET $${p + 1}
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const data = rows.map((r) => ({
      formularyId: r.formulary_id,
      rxcui: r.rxcui,
      ndc: r.ndc,
      tierLevel: r.tier_level_value,
      paRequired: r.prior_authorization_yn,
      stepTherapyRequired: r.step_therapy_yn,
      quantityLimit: r.quantity_limit_yn,
    }));
    return successResponse(res, data, 200, { limit, offset, count: data.length });
  } catch (err) {
    return errorResponse(res, 'Database error while searching formulary', 500, String(err));
  }
});

// 3) List Available Years
app.get('/api/years', async (req, res) => {
  const sql = `
    SELECT DISTINCT year
    FROM prescribers_by_geography_drug
    ORDER BY year ASC
  `;
  try {
    const { rows } = await pool.query(sql);
    const years = rows.map((r) => r.year);
    // For this endpoint, return a simple array
    return res.status(200).json(years);
  } catch (err) {
    return errorResponse(res, 'Database error while listing years', 500, String(err));
  }
});

// Global 404
app.use((req, res) => {
  return errorResponse(res, 'Not found', 404);
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  return errorResponse(res, 'Unexpected server error', 500);
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server listening on port ${PORT}`);
});


