import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { registerMlsMetricsTools } from "./mlsMetricsTools.js";

function parseScopes(value) {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\s]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function getResourceMetadataUrl() {
  const fallback = "https://services.waterfront-ai.com/oai-app";
  const resourceUrl = new URL(process.env.MCP_PUBLIC_URL ?? fallback);
  return new URL(
    `/.well-known/oauth-protected-resource${resourceUrl.pathname}`,
    resourceUrl.origin
  ).href;
}

function buildAuthError(message, error = "insufficient_scope") {
  const resourceMetadata = getResourceMetadataUrl();
  return {
    content: [
      {
        type: "text",
        text: message
      }
    ],
    isError: true,
    _meta: {
      "mcp/www_authenticate": [
        `Bearer resource_metadata="${resourceMetadata}", error="${error}", error_description="${message}"`
      ]
    }
  };
}

function requireAuth(extra, requiredScopes) {
  const authInfo = extra?.authInfo;
  if (!authInfo) {
    if (process.env.OAUTH_LOG_TOKENS === "1") {
      console.warn("MCP auth missing", {
        requiredScopes
      });
    }
    return buildAuthError("Authentication required. Please sign in.");
  }
  if (requiredScopes?.length) {
    const tokenScopes = new Set(
      (authInfo.scopes ?? []).map(scope => scope.split("/").pop())
    );
    const hasAllScopes = requiredScopes.every(scope => {
      const shortScope = scope.split("/").pop();
      return tokenScopes.has(shortScope);
    });
    if (!hasAllScopes) {
      if (process.env.OAUTH_LOG_TOKENS === "1") {
        console.warn("MCP auth insufficient scope", {
          requiredScopes,
          tokenScopes: authInfo.scopes ?? []
        });
      }
      return buildAuthError("Insufficient scope. Please reauthorize.");
    }
  }
  return null;
}

async function resolveStateName(pool, stateInput) {
  const trimmed = String(stateInput || "").trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.length === 2) {
    const lookup = await pool.query(
      `
      select distinct state_name
      from otherdata.zip_city_county_xref
      where upper(state_id) = upper($1)
      order by state_name asc
      limit 1
      `,
      [trimmed]
    );
    if (lookup.rowCount > 0) {
      return lookup.rows[0].state_name;
    }
  }
  return trimmed;
}

const MLS_LATEST_LISTINGS_CTE = `
  with latest_listings as (
    select *,
           row_number() over (
             partition by listing_id
             order by nullif(timestamp, '')::timestamp desc
           ) as rn
    from mls.beaches_residential
    where listing_id is not null
  )
`;

function buildClosedSalesFilters(dateClause) {
  return `
    rn = 1
    and status = 'Closed'
    and nullif(sold_date, '')::date is not null
    ${dateClause}
  `;
}

function buildActiveFilters() {
  return `
    rn = 1
    and status = 'Active'
  `;
}

function buildUnderContractFilters() {
  return `
    rn = 1
    and status in ('Active Under Contract', 'Pending')
  `;
}

function buildNewListingFilters(dateClause) {
  return `
    rn = 1
    and nullif(listing_date, '')::date is not null
    ${dateClause}
  `;
}

export function createMcpServer(pool) {
  const requiredScopes = parseScopes(
    process.env.OAUTH_SCOPES ?? process.env.AZURE_OAUTH_SCOPES
  );
  const server = new McpServer(
    { name: "basic-mcp-db-server", version: "0.1.0" },
    { capabilities: { logging: {} } }
  );
  const MLS_LIST_PARCEL_TYPES = "mls.list_parcel_types";
  const MLS_LIST_CITIES = "mls.list_cities";
  const MLS_LIST_COUNTIES = "mls.list_counties";
  const MLS_LIST_ZIP_CODES = "mls.list_zip_codes";
  const MLS_LIST_AREAS = "mls.list_areas";
  const UTILS_LIST_DEVELOPMENTS = "utils.list_developments";
  const TAX_LIST_LAND_USE_DESCRIPTIONS = "tax.list_land_use_descriptions";
  const TAX_LIST_CONDO_DESCRIPTIONS = "tax.list_condo_descriptions";
  const TAX_LOOKUP_BY_SITUS_ADDRESS = "tax.lookup_by_situs_address";
  const TAX_LOOKUP_BY_DEVELOPMENT = "tax.lookup_by_development_name";
  const TAX_LOOKUP_BY_REGION = "tax.lookup_by_region_name";
  const TAX_LOOKUP_BY_ZONE = "tax.lookup_by_zone_name";
  const TAX_LOOKUP_BY_SUBDIVISION = "tax.lookup_by_subdivision_name";
  const IRS_STATE_INFLOW = "irs.state_inflow";
  const IRS_STATE_OUTFLOW = "irs.state_outflow";
  const IRS_COUNTY_INFLOW = "irs.county_inflow";
  const IRS_COUNTY_OUTFLOW = "irs.county_outflow";
  const IRS_RESOLVE_COUNTY_FIPS_BY_CITY = "irs.resolve_county_fips_by_city_state";
  const IRS_RESOLVE_STATE_FIPS = "irs.resolve_state_fips";
  const IRS_AGI_BY_ZIP = "irs.agi_by_zip";
  const FRED_SERIES_SEARCH = "fred.series_search";
  const FRED_SERIES_OBSERVATIONS = "fred.series_observations";
  const FRED_SERIES_SEARCH_TAGS = "fred.series_search_tags";
  const MLS_COUNT_SALES_BY_DEVELOPMENT_SINCE = "mls.count_sales_by_development_since";
  const MLS_COUNT_SALES_BY_DEVELOPMENT_BETWEEN = "mls.count_sales_by_development_between";
  const MLS_COUNT_SALES_BY_CITY_SINCE = "mls.count_sales_by_city_since";
  const MLS_COUNT_SALES_BY_CITY_BETWEEN = "mls.count_sales_by_city_between";
  const MLS_COUNT_SALES_BY_ZIP_SINCE = "mls.count_sales_by_zip_since";
  const MLS_COUNT_SALES_BY_ZIP_BETWEEN = "mls.count_sales_by_zip_between";
  const MLS_COUNT_SALES_BY_DEVELOPMENT_SUBDIVISION_SINCE =
    "mls.count_sales_by_development_subdivision_since";
  const MLS_COUNT_SALES_BY_DEVELOPMENT_SUBDIVISION_BETWEEN =
    "mls.count_sales_by_development_subdivision_between";
  const MLS_COUNT_ACTIVE_BY_DEVELOPMENT = "mls.count_active_by_development";
  const MLS_COUNT_ACTIVE_BY_CITY = "mls.count_active_by_city";
  const MLS_COUNT_ACTIVE_BY_ZIP = "mls.count_active_by_zip";
  const MLS_MEDIAN_SALE_PRICE_BY_DEVELOPMENT_SINCE =
    "mls.median_sale_price_by_development_since";
  const MLS_AVG_SALE_PRICE_BY_DEVELOPMENT_SINCE = "mls.avg_sale_price_by_development_since";
  const MLS_MEDIAN_SALE_PRICE_BY_DEVELOPMENT_BETWEEN =
    "mls.median_sale_price_by_development_between";
  const MLS_AVG_SALE_PRICE_BY_DEVELOPMENT_BETWEEN =
    "mls.avg_sale_price_by_development_between";
  const MLS_MEDIAN_SALE_PRICE_BY_CITY_SINCE = "mls.median_sale_price_by_city_since";
  const MLS_AVG_SALE_PRICE_BY_CITY_SINCE = "mls.avg_sale_price_by_city_since";
  const MLS_MEDIAN_SALE_PRICE_BY_CITY_BETWEEN = "mls.median_sale_price_by_city_between";
  const MLS_AVG_SALE_PRICE_BY_CITY_BETWEEN = "mls.avg_sale_price_by_city_between";
  const MLS_MEDIAN_SALE_PRICE_BY_ZIP_SINCE = "mls.median_sale_price_by_zip_since";
  const MLS_AVG_SALE_PRICE_BY_ZIP_SINCE = "mls.avg_sale_price_by_zip_since";
  const MLS_MEDIAN_SALE_PRICE_BY_ZIP_BETWEEN = "mls.median_sale_price_by_zip_between";
  const MLS_AVG_SALE_PRICE_BY_ZIP_BETWEEN = "mls.avg_sale_price_by_zip_between";
  const MLS_MEDIAN_PRICE_PER_SQFT_BY_DEVELOPMENT_SINCE =
    "mls.median_price_per_sqft_by_development_since";
  const MLS_MEDIAN_PRICE_PER_SQFT_BY_DEVELOPMENT_BETWEEN =
    "mls.median_price_per_sqft_by_development_between";
  const MLS_MEDIAN_PRICE_PER_SQFT_BY_DEVELOPMENT_SUBDIVISION_SINCE =
    "mls.median_price_per_sqft_by_development_subdivision_since";
  const MLS_MEDIAN_PRICE_PER_SQFT_BY_DEVELOPMENT_SUBDIVISION_BETWEEN =
    "mls.median_price_per_sqft_by_development_subdivision_between";
  const MLS_MEDIAN_DOM_BY_DEVELOPMENT_SINCE = "mls.median_days_on_market_by_development_since";
  const MLS_AVG_DOM_BY_DEVELOPMENT_SINCE = "mls.avg_days_on_market_by_development_since";
  const MLS_MEDIAN_DOM_BY_CITY_SINCE = "mls.median_days_on_market_by_city_since";
  const MLS_AVG_DOM_BY_CITY_SINCE = "mls.avg_days_on_market_by_city_since";
  const MLS_MEDIAN_DOM_BY_DEVELOPMENT_BETWEEN =
    "mls.median_days_on_market_by_development_between";
  const MLS_AVG_DOM_BY_DEVELOPMENT_BETWEEN = "mls.avg_days_on_market_by_development_between";
  const MLS_MEDIAN_DOM_BY_CITY_BETWEEN = "mls.median_days_on_market_by_city_between";
  const MLS_AVG_DOM_BY_CITY_BETWEEN = "mls.avg_days_on_market_by_city_between";
  const MLS_COUNT_NEW_LISTINGS_BY_CITY_SINCE = "mls.count_new_listings_by_city_since";
  const MLS_COUNT_NEW_LISTINGS_BY_DEVELOPMENT_SINCE =
    "mls.count_new_listings_by_development_since";
  const MLS_COUNT_UNDER_CONTRACT_BY_CITY = "mls.count_under_contract_by_city";
  const MLS_COUNT_UNDER_CONTRACT_BY_DEVELOPMENT = "mls.count_under_contract_by_development";
  const MLS_GET_LISTING_BY_PARCEL_ID = "mls.get_listing_by_parcel_id";
  const MLS_GET_LISTING_BY_LISTING_ID = "mls.get_listing_by_listing_id";
  const TAX_PALMBEACH_COLUMNS = `
    property_control_number,
    owner_name,
    owner_address_line1,
    owner_address_line2,
    owner_address_line3,
    legal_line1,
    legal_line2,
    legal_line3,
    situs_address,
    situs_address_prefix,
    situs_address_number,
    situs_address_additional,
    situs_address_pre_directional,
    situs_address_street_name,
    situs_address_street_suffix,
    situs_address_street_suffix2,
    situs_address_city_name,
    situs_address_unit_description,
    situs_address_unit_number,
    situs_address_zip_code,
    land_use_code,
    land_use_description,
    total_market_value,
    total_non_school_assessed_value,
    total_class_use_value,
    total_improvement_value,
    total_land_value,
    total_market_value_for_ag,
    total_previous_market_value,
    total_number_bldg_residential,
    total_number_bldg_commercial,
    total_number_land,
    total_number_oby,
    sales_book_1,
    sales_page_1,
    sales_date_1,
    sales_instrument_type_1,
    sales_validity_code_1,
    sales_type_code_1,
    sales_price_1,
    sales_book_2,
    sales_page_2,
    sales_date_2,
    sales_instrument_type_2,
    sales_validity_code_2,
    sales_type_code_2,
    sales_price_2,
    sales_book_3,
    sales_page_3,
    sales_date_3,
    sales_instrument_type_3,
    sales_validity_code_3,
    sales_type_code_3,
    sales_price_3,
    sales_book_4,
    sales_page_4,
    sales_date_4,
    sales_instrument_type_4,
    sales_validity_code_4,
    sales_type_code_4,
    sales_price_4,
    sales_book_5,
    sales_page_5,
    sales_date_5,
    sales_instrument_type_5,
    sales_validity_code_5,
    sales_type_code_5,
    sales_price_5,
    res_classification,
    res_classification_description,
    resbld_year_built,
    effective_year,
    number_of_bedrooms,
    number_of_full_bathrooms,
    number_of_half_bathrooms,
    story_height,
    exterior_wall_code,
    exterior_wall_description,
    exterior_wall2_code,
    exterior_wall2_description,
    roof_structure_code,
    roof_structure_description,
    roof_cover_code,
    roof_cover_description,
    interior_wall_code,
    interior_wall_description,
    floor_type1_code,
    floor_type1_description,
    floor_type2_code,
    floor_type2_description,
    heat_code,
    heat_description,
    heating_system_type,
    heating_system_type_description,
    heating_fuel_type,
    heating_fuel_type_description,
    grade_code,
    grade_description,
    condition,
    condition_description,
    adjustment_factor,
    building_value,
    building_area,
    total_area,
    square_foot_living_area,
    land_type_code,
    land_type_description,
    land_classification_code,
    land_classification_description,
    zone,
    actual_frontage,
    effective_frontage,
    depth,
    note1,
    square_feet,
    acres,
    units,
    base_rate,
    override_incremental_rate,
    price,
    ag_flag,
    complex_id,
    complex_name,
    unit_number,
    building_card,
    condo_classification_code,
    condo_classification_description,
    condo_year_built,
    condominium_floor_type_code,
    condominium_floor_type_description,
    condominium_floor_level,
    condo_number_of_bedrooms,
    condo_number_of_bathrooms,
    condo_number_of_half_baths,
    condo_area,
    condo_value,
    development_name,
    subdivision_name,
    region_name,
    zone_name
  `;

  server.registerTool(
    "db.ping",
    {
      description: "Run a simple query to verify database connectivity.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async (_args, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query("select 1 as ok");
      return {
        content: [
          {
            type: "text",
            text: `ok=${result.rows?.[0]?.ok ?? "unknown"}`
          }
        ]
      };
    }
  );

  server.registerTool(
    MLS_LIST_PARCEL_TYPES,
    {
      description: "List distinct MLS parcel types.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async (_args, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select distinct type
        from mls.beaches_residential
        where type is not null
          and trim(type) != ''
        order by type asc
        `
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: result.rowCount ?? 0,
                types: result.rows.map(row => row.type)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    MLS_LIST_CITIES,
    {
      description: "List distinct MLS cities.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(2000).default(500)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select distinct city
        from mls.beaches_residential
        where city is not null
          and trim(city) != ''
        order by city asc
        limit $1
        `,
        [limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: result.rowCount ?? 0,
                limit,
                cities: result.rows.map(row => row.city)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    MLS_LIST_COUNTIES,
    {
      description: "List distinct MLS counties.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(2000).default(500)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select distinct county
        from mls.beaches_residential
        where county is not null
          and trim(county) != ''
        order by county asc
        limit $1
        `,
        [limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: result.rowCount ?? 0,
                limit,
                counties: result.rows.map(row => row.county)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    MLS_LIST_ZIP_CODES,
    {
      description: "List distinct MLS zip codes.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(2000).default(500)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select distinct zip_code
        from mls.beaches_residential
        where zip_code is not null
          and trim(zip_code) != ''
        order by zip_code asc
        limit $1
        `,
        [limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: result.rowCount ?? 0,
                limit,
                zip_codes: result.rows.map(row => row.zip_code)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    TAX_LIST_LAND_USE_DESCRIPTIONS,
    {
      description: "List distinct Palm Beach parcel land use descriptions.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(5000).default(1000)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select distinct land_use_description
        from tax.palmbeach_parcel
        where land_use_description is not null
          and trim(land_use_description) != ''
        order by land_use_description asc
        limit $1
        `,
        [limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: result.rowCount ?? 0,
                limit,
                land_use_descriptions: result.rows.map(row => row.land_use_description)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    TAX_LIST_CONDO_DESCRIPTIONS,
    {
      description: "List distinct Palm Beach condo classification descriptions.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(5000).default(1000)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select distinct classification_description
        from tax.palmbeach_condo
        where classification_description is not null
          and trim(classification_description) != ''
        order by classification_description asc
        limit $1
        `,
        [limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: result.rowCount ?? 0,
                limit,
                condo_descriptions: result.rows.map(row => row.classification_description)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    MLS_LIST_AREAS,
    {
      description: "List distinct MLS areas.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(2000).default(500)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select distinct area
        from mls.beaches_residential
        where area is not null
          and trim(area) != ''
        order by area asc
        limit $1
        `,
        [limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: result.rowCount ?? 0,
                limit,
                areas: result.rows.map(row => row.area)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    TAX_LOOKUP_BY_SITUS_ADDRESS,
    {
      description: "Fetch Palm Beach tax records by situs address (contains match).",
      inputSchema: z.object({
        address: z.string().trim().min(3).max(200),
        limit: z.number().int().min(1).max(200).default(25)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ address, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const pattern = `%${address.trim()}%`;
      const result = await pool.query(
        `
        select ${TAX_PALMBEACH_COLUMNS}
        from tax.vw_palmbeach_full
        where situs_address is not null
          and trim(situs_address) != ''
          and situs_address ILIKE $1
        order by situs_address asc
        limit $2
        `,
        [pattern, limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                address,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    TAX_LOOKUP_BY_DEVELOPMENT,
    {
      description: "Fetch Palm Beach tax records by development name.",
      inputSchema: z.object({
        development_name: z.string().trim().min(2).max(200),
        limit: z.number().int().min(1).max(500).default(100)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ development_name, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select ${TAX_PALMBEACH_COLUMNS}
        from tax.vw_palmbeach_full
        where development_name is not null
          and trim(development_name) != ''
          and development_name ILIKE $1
        order by development_name asc, situs_address asc
        limit $2
        `,
        [development_name.trim(), limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                development_name,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    TAX_LOOKUP_BY_REGION,
    {
      description: "Fetch Palm Beach tax records by region name.",
      inputSchema: z.object({
        region_name: z.string().trim().min(2).max(200),
        limit: z.number().int().min(1).max(500).default(100)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ region_name, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select ${TAX_PALMBEACH_COLUMNS}
        from tax.vw_palmbeach_full
        where region_name is not null
          and trim(region_name) != ''
          and region_name ILIKE $1
        order by region_name asc, situs_address asc
        limit $2
        `,
        [region_name.trim(), limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                region_name,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    TAX_LOOKUP_BY_ZONE,
    {
      description: "Fetch Palm Beach tax records by zone name.",
      inputSchema: z.object({
        zone_name: z.string().trim().min(2).max(200),
        limit: z.number().int().min(1).max(500).default(100)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ zone_name, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select ${TAX_PALMBEACH_COLUMNS}
        from tax.vw_palmbeach_full
        where zone_name is not null
          and trim(zone_name) != ''
          and zone_name ILIKE $1
        order by zone_name asc, situs_address asc
        limit $2
        `,
        [zone_name.trim(), limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                zone_name,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    TAX_LOOKUP_BY_SUBDIVISION,
    {
      description: "Fetch Palm Beach tax records by subdivision name.",
      inputSchema: z.object({
        subdivision_name: z.string().trim().min(2).max(200),
        limit: z.number().int().min(1).max(500).default(100)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ subdivision_name, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select ${TAX_PALMBEACH_COLUMNS}
        from tax.vw_palmbeach_full
        where subdivision_name is not null
          and trim(subdivision_name) != ''
          and subdivision_name ILIKE $1
        order by subdivision_name asc, situs_address asc
        limit $2
        `,
        [subdivision_name.trim(), limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                subdivision_name,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    IRS_RESOLVE_STATE_FIPS,
    {
      description: "Resolve a state FIPS code by state name or abbreviation.",
      inputSchema: z.object({
        state: z.string().trim().min(2).max(100)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ state }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const trimmed = state.trim();
      const result = await pool.query(
        `
        select lpad(fips::text, 2, '0') as state_fips, state
        from irs.state_fips_xref
        where upper(state) = upper($1)
           or upper(state) = upper($2)
        limit 5
        `,
        [trimmed, trimmed]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                state,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    IRS_RESOLVE_COUNTY_FIPS_BY_CITY,
    {
      description: "Resolve county FIPS codes by city and state.",
      inputSchema: z.object({
        city: z.string().trim().min(2).max(100),
        state: z.string().trim().min(2).max(100),
        limit: z.number().int().min(1).max(25).default(10)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ city, state, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select distinct
          lpad(county_fips::text, 5, '0') as county_fips,
          county_name,
          state_id,
          state_name
        from otherdata.zip_city_county_xref
        where city ILIKE $1
          and (state_id ILIKE $2 or state_name ILIKE $2)
        order by county_name asc
        limit $3
        `,
        [`%${city.trim()}%`, state.trim(), limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                city,
                state,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    IRS_STATE_INFLOW,
    {
      description: "Fetch IRS state inflow data for the latest migration year.",
      inputSchema: z.object({
        state: z.string().trim().min(2).max(100),
        limit: z.number().int().min(1).max(50).default(10)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ state, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const resolvedState = await resolveStateName(pool, state);
      const result = await pool.query(
        `
        with latest_year as (
          select max(migration_year) as value
          from irs.vw_stateinflow
          where destination_state ILIKE $1
        )
        select
          origin_state,
          destination_state,
          number_of_returns,
          number_of_individuals,
          adjusted_gross_income,
          migration_year
        from irs.vw_stateinflow
        where destination_state ILIKE $1
          and migration_year = (select value from latest_year)
        order by number_of_returns desc nulls last
        limit $2
        `,
        [resolvedState, limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                state: resolvedState,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    IRS_STATE_OUTFLOW,
    {
      description: "Fetch IRS state outflow data for the latest migration year.",
      inputSchema: z.object({
        state: z.string().trim().min(2).max(100),
        limit: z.number().int().min(1).max(50).default(10)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ state, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const resolvedState = await resolveStateName(pool, state);
      const result = await pool.query(
        `
        with latest_year as (
          select max(migration_year) as value
          from irs.vw_stateoutflow
          where origin_state ILIKE $1
        )
        select
          origin_state,
          destination_state,
          number_of_returns,
          number_of_individuals,
          adjusted_gross_income,
          migration_year
        from irs.vw_stateoutflow
        where origin_state ILIKE $1
          and migration_year = (select value from latest_year)
        order by number_of_returns desc nulls last
        limit $2
        `,
        [resolvedState, limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                state: resolvedState,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    IRS_COUNTY_INFLOW,
    {
      description: "Fetch IRS county inflow data for the latest migration year.",
      inputSchema: z.object({
        county: z.string().trim().min(2).max(100),
        state: z.string().trim().min(2).max(100),
        limit: z.number().int().min(1).max(50).default(10)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ county, state, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const resolvedState = await resolveStateName(pool, state);
      const countyPattern = `%${county.trim()}%`;
      const result = await pool.query(
        `
        with latest_year as (
          select max(migration_year) as value
          from irs.vw_countyinflow
          where destination_state ILIKE $1
            and destination_county ILIKE $2
        )
        select
          origin_state,
          origin_county,
          destination_state,
          destination_county,
          number_of_returns,
          number_of_individuals,
          adjusted_gross_income,
          migration_year
        from irs.vw_countyinflow
        where destination_state ILIKE $1
          and destination_county ILIKE $2
          and migration_year = (select value from latest_year)
        order by number_of_returns desc nulls last
        limit $3
        `,
        [resolvedState, countyPattern, limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                county,
                state: resolvedState,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    IRS_COUNTY_OUTFLOW,
    {
      description: "Fetch IRS county outflow data for the latest migration year.",
      inputSchema: z.object({
        county: z.string().trim().min(2).max(100),
        state: z.string().trim().min(2).max(100),
        limit: z.number().int().min(1).max(50).default(10)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ county, state, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const resolvedState = await resolveStateName(pool, state);
      const countyPattern = `%${county.trim()}%`;
      const result = await pool.query(
        `
        with latest_year as (
          select max(migration_year) as value
          from irs.vw_countyoutflow
          where origin_state ILIKE $1
            and origin_county ILIKE $2
        )
        select
          origin_state,
          origin_county,
          destination_state,
          destination_county,
          number_of_returns,
          number_of_individuals,
          adjusted_gross_income,
          migration_year
        from irs.vw_countyoutflow
        where origin_state ILIKE $1
          and origin_county ILIKE $2
          and migration_year = (select value from latest_year)
        order by number_of_returns desc nulls last
        limit $3
        `,
        [resolvedState, countyPattern, limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                county,
                state: resolvedState,
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    IRS_AGI_BY_ZIP,
    {
      description: "Fetch IRS AGI statistics by ZIP code (all AGI brackets).",
      inputSchema: z.object({
        zip_code: z.string().trim().min(3).max(10),
        year: z.string().trim().min(4).max(4).optional()
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ zip_code, year }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const normalizedZip = zip_code.trim();
      const params = [normalizedZip];
      let yearClause = "";
      if (year) {
        params.push(year.trim());
        yearClause = `and year = $${params.length}`;
      }

      const result = await pool.query(
        `
        select
          state,
          lpad(zipcode::text, 5, '0') as zip_code,
          agi_stub,
          returns,
          individuals,
          agi,
          year
        from irs.agi_zip
        where lpad(zipcode::text, 5, '0') = lpad($1::text, 5, '0')
          ${yearClause}
        order by year desc, agi_stub asc
        `,
        params
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                zip_code,
                year: year ?? null,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    FRED_SERIES_SEARCH,
    {
      description: "Search FRED series IDs by keyword.",
      inputSchema: z.object({
        search_text: z.string().trim().min(2).max(200),
        search_type: z.enum(["full_text", "series_id"]).default("full_text"),
        limit: z.number().int().min(1).max(200).default(25),
        order_by: z
          .enum([
            "search_rank",
            "series_id",
            "title",
            "units",
            "frequency",
            "seasonal_adjustment",
            "realtime_start",
            "realtime_end",
            "last_updated",
            "observation_start",
            "observation_end",
            "popularity",
            "group_popularity"
          ])
          .default("search_rank"),
        sort_order: z.enum(["asc", "desc"]).default("desc")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ search_text, search_type, limit, order_by, sort_order }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const apiKey = process.env.FRED_API_KEY;
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "FRED_API_KEY is not configured."
            }
          ],
          isError: true
        };
      }

      const url = new URL("https://api.stlouisfed.org/fred/series/search");
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("file_type", "json");
      url.searchParams.set("search_text", search_text);
      url.searchParams.set("search_type", search_type);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("order_by", order_by);
      url.searchParams.set("sort_order", sort_order);

      const response = await fetch(url.toString());
      if (!response.ok) {
        const body = await response.text();
        return {
          content: [
            {
              type: "text",
              text: `FRED series search failed: ${response.status} ${body.slice(0, 300)}`
            }
          ],
          isError: true
        };
      }

      const payload = await response.json();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                search_text,
                count: payload?.count ?? null,
                offset: payload?.offset ?? null,
                limit: payload?.limit ?? limit,
                rows: payload?.seriess ?? []
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    FRED_SERIES_OBSERVATIONS,
    {
      description: "Fetch FRED series observations by series ID.",
      inputSchema: z.object({
        series_id: z.string().trim().min(1).max(50),
        observation_start: z.string().trim().min(4).max(10).optional(),
        observation_end: z.string().trim().min(4).max(10).optional(),
        limit: z.number().int().min(1).max(1000).default(100),
        sort_order: z.enum(["asc", "desc"]).default("desc")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ series_id, observation_start, observation_end, limit, sort_order }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const apiKey = process.env.FRED_API_KEY;
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "FRED_API_KEY is not configured."
            }
          ],
          isError: true
        };
      }

      const url = new URL("https://api.stlouisfed.org/fred/series/observations");
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("file_type", "json");
      url.searchParams.set("series_id", series_id);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("sort_order", sort_order);
      if (observation_start) {
        url.searchParams.set("observation_start", observation_start);
      }
      if (observation_end) {
        url.searchParams.set("observation_end", observation_end);
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        const body = await response.text();
        return {
          content: [
            {
              type: "text",
              text: `FRED observations failed: ${response.status} ${body.slice(0, 300)}`
            }
          ],
          isError: true
        };
      }

      const payload = await response.json();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                series_id,
                count: payload?.count ?? null,
                offset: payload?.offset ?? null,
                limit: payload?.limit ?? limit,
                observations: payload?.observations ?? []
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    FRED_SERIES_SEARCH_TAGS,
    {
      description: "Fetch tags related to a FRED series search query.",
      inputSchema: z.object({
        series_search_text: z.string().trim().min(2).max(200),
        limit: z.number().int().min(1).max(200).default(25),
        order_by: z.enum(["series_count", "popularity", "name", "group_id"]).default("series_count"),
        sort_order: z.enum(["asc", "desc"]).default("desc")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ series_search_text, limit, order_by, sort_order }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const apiKey = process.env.FRED_API_KEY;
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "FRED_API_KEY is not configured."
            }
          ],
          isError: true
        };
        }

      const url = new URL("https://api.stlouisfed.org/fred/series/search/tags");
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("file_type", "json");
      url.searchParams.set("series_search_text", series_search_text);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("order_by", order_by);
      url.searchParams.set("sort_order", sort_order);

      const response = await fetch(url.toString());
      if (!response.ok) {
        const body = await response.text();
        return {
          content: [
            {
              type: "text",
              text: `FRED search tags failed: ${response.status} ${body.slice(0, 300)}`
            }
          ],
          isError: true
        };
      }

      const payload = await response.json();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                series_search_text,
                count: payload?.count ?? null,
                offset: payload?.offset ?? null,
                limit: payload?.limit ?? limit,
                tags: payload?.tags ?? []
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    UTILS_LIST_DEVELOPMENTS,
    {
      description:
        "List distinct MLS development names, optionally filtered by a partial match.",
      inputSchema: z.object({
        search: z.string().trim().min(1).max(100).optional(),
        match: z.enum(["contains", "prefix"]).default("contains"),
        limit: z.number().int().min(1).max(2000).default(500)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ search, match, limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const params = [];
      const where = ["development_name is not null", "trim(development_name) != ''"];

      if (search) {
        const trimmed = search.trim();
        const pattern = match === "prefix" ? `${trimmed}%` : `%${trimmed}%`;
        params.push(pattern);
        where.push(`development_name ILIKE $${params.length}`);
      }

      params.push(limit);

      const result = await pool.query(
        `
        select distinct development_name
        from waterfrontdata.development_data
        where ${where.join(" and ")}
        order by development_name asc
        limit $${params.length}
        `,
        params
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: result.rowCount ?? 0,
                search: search ?? null,
                match,
                limit,
                developments: result.rows.map(row => row.development_name)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    "market_trends.single_family",
    {
      description: "Fetch market trends for single-family homes.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(5000).default(500)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select *
        from waterfrontdata.market_trends_sfh
        limit $1
        `,
        [limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.registerTool(
    "market_trends.condo",
    {
      description: "Fetch market trends for condos.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(5000).default(500)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: requiredScopes }]
      }
    },
    async ({ limit }, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) {
        return authError;
      }

      const result = await pool.query(
        `
        select *
        from waterfrontdata.market_trends_condo
        limit $1
        `,
        [limit]
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                limit,
                count: result.rowCount ?? 0,
                rows: result.rows
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  registerMlsMetricsTools({ server, pool, requiredScopes, requireAuth });

  return server;
}
