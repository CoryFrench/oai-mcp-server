import * as z from "zod";

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

function registerCountTool({
  server,
  pool,
  requiredScopes,
  requireAuth,
  name,
  description,
  whereField,
  hasSubdivision = false,
  dateMode
}) {
  const baseSchema = {
    [whereField]: z.string().trim().min(2).max(200)
  };
  if (hasSubdivision) {
    baseSchema.subdivision = z.string().trim().min(2).max(200);
  }
  baseSchema.date_from = z.string().trim().min(8).max(10);
  if (dateMode === "between") {
    baseSchema.date_to = z.string().trim().min(8).max(10);
  }

  server.registerTool(
    name,
    {
      description,
      inputSchema: z.object(baseSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: requiredScopes }] }
    },
    async (args, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) return authError;

      const params = [];
      const clauses = [];
      const mainValue = args[whereField].trim();
      params.push(mainValue);
      clauses.push(`${whereField} ILIKE $${params.length}`);

      if (hasSubdivision) {
        params.push(args.subdivision.trim());
        clauses.push(`subdivision ILIKE $${params.length}`);
      }

      if (dateMode === "since") {
        params.push(args.date_from);
        clauses.push(`nullif(sold_date, '')::date >= $${params.length}`);
      } else {
        params.push(args.date_from, args.date_to);
        clauses.push(`nullif(sold_date, '')::date between $${params.length - 1} and $${params.length}`);
      }

      const result = await pool.query(
        `
        ${MLS_LATEST_LISTINGS_CTE}
        select count(*)::int as count
        from latest_listings
        where ${buildClosedSalesFilters("")}
          and ${clauses.join(" and ")}
        `,
        params
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...args,
                count: result.rows?.[0]?.count ?? 0
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

function registerActiveCountTool({ server, pool, requiredScopes, requireAuth, name, description, field }) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: z.object({ [field]: z.string().trim().min(2).max(200) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: requiredScopes }] }
    },
    async (args, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) return authError;
      const value = args[field].trim();
      const result = await pool.query(
        `
        ${MLS_LATEST_LISTINGS_CTE}
        select count(*)::int as count
        from latest_listings
        where ${buildActiveFilters()}
          and ${field} ILIKE $1
        `,
        [value]
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ [field]: value, count: result.rows?.[0]?.count ?? 0 }, null, 2)
          }
        ]
      };
    }
  );
}

function registerAggregateTool({
  server,
  pool,
  requiredScopes,
  requireAuth,
  name,
  description,
  whereField,
  hasSubdivision = false,
  dateMode,
  aggExpr,
  resultKey,
  extraFilters = ""
}) {
  const baseSchema = {
    [whereField]: z.string().trim().min(2).max(200)
  };
  if (hasSubdivision) {
    baseSchema.subdivision = z.string().trim().min(2).max(200);
  }
  baseSchema.date_from = z.string().trim().min(8).max(10);
  if (dateMode === "between") {
    baseSchema.date_to = z.string().trim().min(8).max(10);
  }

  server.registerTool(
    name,
    {
      description,
      inputSchema: z.object(baseSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: requiredScopes }] }
    },
    async (args, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) return authError;

      const params = [];
      const clauses = [];
      const mainValue = args[whereField].trim();
      params.push(mainValue);
      clauses.push(`${whereField} ILIKE $${params.length}`);

      if (hasSubdivision) {
        params.push(args.subdivision.trim());
        clauses.push(`subdivision ILIKE $${params.length}`);
      }

      if (dateMode === "since") {
        params.push(args.date_from);
        clauses.push(`nullif(sold_date, '')::date >= $${params.length}`);
      } else {
        params.push(args.date_from, args.date_to);
        clauses.push(`nullif(sold_date, '')::date between $${params.length - 1} and $${params.length}`);
      }

      const result = await pool.query(
        `
        ${MLS_LATEST_LISTINGS_CTE}
        select ${aggExpr} as value,
               count(*)::int as count
        from latest_listings
        where ${buildClosedSalesFilters("")}
          and ${clauses.join(" and ")}
          ${extraFilters}
        `,
        params
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...args,
                [resultKey]: result.rows?.[0]?.value ?? null,
                count: result.rows?.[0]?.count ?? 0
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

function registerNewListingCount({ server, pool, requiredScopes, requireAuth, name, description, field }) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: z.object({
        [field]: z.string().trim().min(2).max(200),
        date_from: z.string().trim().min(8).max(10)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: requiredScopes }] }
    },
    async (args, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) return authError;
      const params = [args[field].trim(), args.date_from];
      const result = await pool.query(
        `
        ${MLS_LATEST_LISTINGS_CTE}
        select count(*)::int as count
        from latest_listings
        where ${buildNewListingFilters("and nullif(listing_date, '')::date >= $2")}
          and ${field} ILIKE $1
        `,
        params
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...args, count: result.rows?.[0]?.count ?? 0 }, null, 2)
          }
        ]
      };
    }
  );
}

function registerUnderContractCount({ server, pool, requiredScopes, requireAuth, name, description, field }) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: z.object({ [field]: z.string().trim().min(2).max(200) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: requiredScopes }] }
    },
    async (args, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) return authError;
      const value = args[field].trim();
      const result = await pool.query(
        `
        ${MLS_LATEST_LISTINGS_CTE}
        select count(*)::int as count
        from latest_listings
        where ${buildUnderContractFilters()}
          and ${field} ILIKE $1
        `,
        [value]
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ [field]: value, count: result.rows?.[0]?.count ?? 0 }, null, 2)
          }
        ]
      };
    }
  );
}

function registerListingLookup({ server, pool, requiredScopes, requireAuth, name, description, field, limit }) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: z.object({ [field]: z.string().trim().min(3).max(50) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: requiredScopes }] }
    },
    async (args, extra) => {
      const authError = requireAuth(extra, requiredScopes);
      if (authError) return authError;
      const value = args[field].trim();
      const result = await pool.query(
        `
        ${MLS_LATEST_LISTINGS_CTE}
        select *
        from latest_listings
        where rn = 1
          and ${field} = $1
        limit ${limit}
        `,
        [value]
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ [field]: value, count: result.rowCount ?? 0, rows: result.rows }, null, 2)
          }
        ]
      };
    }
  );
}

export function registerMlsMetricsTools({ server, pool, requiredScopes, requireAuth }) {
  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_development_since",
    description: "Count closed sales for a development since a date.",
    whereField: "development_name",
    dateMode: "since"
  });

  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_development_between",
    description: "Count closed sales for a development between two dates.",
    whereField: "development_name",
    dateMode: "between"
  });

  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_city_since",
    description: "Count closed sales for a city since a date.",
    whereField: "city",
    dateMode: "since"
  });

  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_city_between",
    description: "Count closed sales for a city between two dates.",
    whereField: "city",
    dateMode: "between"
  });

  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_zip_since",
    description: "Count closed sales for a ZIP since a date.",
    whereField: "zip_code",
    dateMode: "since"
  });

  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_zip_between",
    description: "Count closed sales for a ZIP between two dates.",
    whereField: "zip_code",
    dateMode: "between"
  });

  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_area_since",
    description: "Count closed sales for an MLS area since a date.",
    whereField: "area",
    dateMode: "since"
  });

  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_area_between",
    description: "Count closed sales for an MLS area between two dates.",
    whereField: "area",
    dateMode: "between"
  });

  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_development_subdivision_since",
    description: "Count closed sales for a development and subdivision since a date.",
    whereField: "development_name",
    hasSubdivision: true,
    dateMode: "since"
  });

  registerCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_sales_by_development_subdivision_between",
    description: "Count closed sales for a development and subdivision between two dates.",
    whereField: "development_name",
    hasSubdivision: true,
    dateMode: "between"
  });

  registerActiveCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_active_by_development",
    description: "Count active listings for a development.",
    field: "development_name"
  });

  registerActiveCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_active_by_city",
    description: "Count active listings for a city.",
    field: "city"
  });

  registerActiveCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_active_by_zip",
    description: "Count active listings for a ZIP.",
    field: "zip_code"
  });

  registerActiveCountTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_active_by_area",
    description: "Count active listings for an MLS area.",
    field: "area"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_sale_price_by_development_since",
    description: "Median sale price for a development since a date.",
    whereField: "development_name",
    dateMode: "since",
    aggExpr: "percentile_cont(0.5) within group (order by nullif(sold_price, '')::numeric)",
    resultKey: "median_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_sale_price_by_development_since",
    description: "Average sale price for a development since a date.",
    whereField: "development_name",
    dateMode: "since",
    aggExpr: "avg(nullif(sold_price, '')::numeric)",
    resultKey: "avg_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_sale_price_by_development_between",
    description: "Median sale price for a development between two dates.",
    whereField: "development_name",
    dateMode: "between",
    aggExpr: "percentile_cont(0.5) within group (order by nullif(sold_price, '')::numeric)",
    resultKey: "median_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_sale_price_by_development_between",
    description: "Average sale price for a development between two dates.",
    whereField: "development_name",
    dateMode: "between",
    aggExpr: "avg(nullif(sold_price, '')::numeric)",
    resultKey: "avg_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_sale_price_by_city_since",
    description: "Median sale price for a city since a date.",
    whereField: "city",
    dateMode: "since",
    aggExpr: "percentile_cont(0.5) within group (order by nullif(sold_price, '')::numeric)",
    resultKey: "median_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_sale_price_by_city_since",
    description: "Average sale price for a city since a date.",
    whereField: "city",
    dateMode: "since",
    aggExpr: "avg(nullif(sold_price, '')::numeric)",
    resultKey: "avg_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_sale_price_by_city_between",
    description: "Median sale price for a city between two dates.",
    whereField: "city",
    dateMode: "between",
    aggExpr: "percentile_cont(0.5) within group (order by nullif(sold_price, '')::numeric)",
    resultKey: "median_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_sale_price_by_city_between",
    description: "Average sale price for a city between two dates.",
    whereField: "city",
    dateMode: "between",
    aggExpr: "avg(nullif(sold_price, '')::numeric)",
    resultKey: "avg_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_sale_price_by_zip_since",
    description: "Median sale price for a ZIP since a date.",
    whereField: "zip_code",
    dateMode: "since",
    aggExpr: "percentile_cont(0.5) within group (order by nullif(sold_price, '')::numeric)",
    resultKey: "median_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_sale_price_by_zip_since",
    description: "Average sale price for a ZIP since a date.",
    whereField: "zip_code",
    dateMode: "since",
    aggExpr: "avg(nullif(sold_price, '')::numeric)",
    resultKey: "avg_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_sale_price_by_zip_between",
    description: "Median sale price for a ZIP between two dates.",
    whereField: "zip_code",
    dateMode: "between",
    aggExpr: "percentile_cont(0.5) within group (order by nullif(sold_price, '')::numeric)",
    resultKey: "median_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_sale_price_by_zip_between",
    description: "Average sale price for a ZIP between two dates.",
    whereField: "zip_code",
    dateMode: "between",
    aggExpr: "avg(nullif(sold_price, '')::numeric)",
    resultKey: "avg_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_sale_price_by_area_since",
    description: "Median sale price for an MLS area since a date.",
    whereField: "area",
    dateMode: "since",
    aggExpr: "percentile_cont(0.5) within group (order by nullif(sold_price, '')::numeric)",
    resultKey: "median_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_sale_price_by_area_since",
    description: "Average sale price for an MLS area since a date.",
    whereField: "area",
    dateMode: "since",
    aggExpr: "avg(nullif(sold_price, '')::numeric)",
    resultKey: "avg_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_sale_price_by_area_between",
    description: "Median sale price for an MLS area between two dates.",
    whereField: "area",
    dateMode: "between",
    aggExpr: "percentile_cont(0.5) within group (order by nullif(sold_price, '')::numeric)",
    resultKey: "median_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_sale_price_by_area_between",
    description: "Average sale price for an MLS area between two dates.",
    whereField: "area",
    dateMode: "between",
    aggExpr: "avg(nullif(sold_price, '')::numeric)",
    resultKey: "avg_sale_price",
    extraFilters: "and nullif(sold_price, '') is not null"
  });

  const pricePerSqftExpr = "percentile_cont(0.5) within group (order by (nullif(sold_price, '')::numeric / nullif(nullif(sqft_living, '')::numeric, 0)))";
  const pricePerSqftFilter = "and nullif(sold_price, '') is not null and nullif(sqft_living, '') is not null";

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_price_per_sqft_by_development_since",
    description: "Median sale price per sqft for a development since a date.",
    whereField: "development_name",
    dateMode: "since",
    aggExpr: pricePerSqftExpr,
    resultKey: "median_price_per_sqft",
    extraFilters: pricePerSqftFilter
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_price_per_sqft_by_development_between",
    description: "Median sale price per sqft for a development between two dates.",
    whereField: "development_name",
    dateMode: "between",
    aggExpr: pricePerSqftExpr,
    resultKey: "median_price_per_sqft",
    extraFilters: pricePerSqftFilter
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_price_per_sqft_by_area_since",
    description: "Median sale price per sqft for an MLS area since a date.",
    whereField: "area",
    dateMode: "since",
    aggExpr: pricePerSqftExpr,
    resultKey: "median_price_per_sqft",
    extraFilters: pricePerSqftFilter
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_price_per_sqft_by_area_between",
    description: "Median sale price per sqft for an MLS area between two dates.",
    whereField: "area",
    dateMode: "between",
    aggExpr: pricePerSqftExpr,
    resultKey: "median_price_per_sqft",
    extraFilters: pricePerSqftFilter
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_price_per_sqft_by_development_subdivision_since",
    description: "Median sale price per sqft for a development + subdivision since a date.",
    whereField: "development_name",
    hasSubdivision: true,
    dateMode: "since",
    aggExpr: pricePerSqftExpr,
    resultKey: "median_price_per_sqft",
    extraFilters: pricePerSqftFilter
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_price_per_sqft_by_development_subdivision_between",
    description: "Median sale price per sqft for a development + subdivision between two dates.",
    whereField: "development_name",
    hasSubdivision: true,
    dateMode: "between",
    aggExpr: pricePerSqftExpr,
    resultKey: "median_price_per_sqft",
    extraFilters: pricePerSqftFilter
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_days_on_market_by_development_since",
    description: "Median days on market for a development since a date.",
    whereField: "development_name",
    dateMode: "since",
    aggExpr:
      "percentile_cont(0.5) within group (order by (nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "median_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_days_on_market_by_development_since",
    description: "Average days on market for a development since a date.",
    whereField: "development_name",
    dateMode: "since",
    aggExpr: "avg((nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "avg_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_days_on_market_by_city_since",
    description: "Median days on market for a city since a date.",
    whereField: "city",
    dateMode: "since",
    aggExpr:
      "percentile_cont(0.5) within group (order by (nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "median_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_days_on_market_by_city_since",
    description: "Average days on market for a city since a date.",
    whereField: "city",
    dateMode: "since",
    aggExpr: "avg((nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "avg_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_days_on_market_by_area_since",
    description: "Median days on market for an MLS area since a date.",
    whereField: "area",
    dateMode: "since",
    aggExpr:
      "percentile_cont(0.5) within group (order by (nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "median_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_days_on_market_by_area_since",
    description: "Average days on market for an MLS area since a date.",
    whereField: "area",
    dateMode: "since",
    aggExpr: "avg((nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "avg_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_days_on_market_by_development_between",
    description: "Median days on market for a development between two dates.",
    whereField: "development_name",
    dateMode: "between",
    aggExpr:
      "percentile_cont(0.5) within group (order by (nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "median_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_days_on_market_by_development_between",
    description: "Average days on market for a development between two dates.",
    whereField: "development_name",
    dateMode: "between",
    aggExpr: "avg((nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "avg_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_days_on_market_by_city_between",
    description: "Median days on market for a city between two dates.",
    whereField: "city",
    dateMode: "between",
    aggExpr:
      "percentile_cont(0.5) within group (order by (nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "median_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_days_on_market_by_city_between",
    description: "Average days on market for a city between two dates.",
    whereField: "city",
    dateMode: "between",
    aggExpr: "avg((nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "avg_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.median_days_on_market_by_area_between",
    description: "Median days on market for an MLS area between two dates.",
    whereField: "area",
    dateMode: "between",
    aggExpr:
      "percentile_cont(0.5) within group (order by (nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "median_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerAggregateTool({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.avg_days_on_market_by_area_between",
    description: "Average days on market for an MLS area between two dates.",
    whereField: "area",
    dateMode: "between",
    aggExpr: "avg((nullif(sold_date, '')::date - nullif(listing_date, '')::date))",
    resultKey: "avg_days_on_market",
    extraFilters: "and nullif(listing_date, '')::date is not null"
  });

  registerNewListingCount({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_new_listings_by_city_since",
    description: "Count new listings for a city since a date.",
    field: "city"
  });

  registerNewListingCount({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_new_listings_by_development_since",
    description: "Count new listings for a development since a date.",
    field: "development_name"
  });

  registerNewListingCount({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_new_listings_by_area_since",
    description: "Count new listings for an MLS area since a date.",
    field: "area"
  });

  registerUnderContractCount({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_under_contract_by_city",
    description: "Count under contract listings for a city.",
    field: "city"
  });

  registerUnderContractCount({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_under_contract_by_development",
    description: "Count under contract listings for a development.",
    field: "development_name"
  });

  registerUnderContractCount({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.count_under_contract_by_area",
    description: "Count under contract listings for an MLS area.",
    field: "area"
  });

  registerListingLookup({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.get_listing_by_parcel_id",
    description: "Fetch the latest listing by parcel ID.",
    field: "parcel_id",
    limit: 5
  });

  registerListingLookup({
    server,
    pool,
    requiredScopes,
    requireAuth,
    name: "mls.get_listing_by_listing_id",
    description: "Fetch the latest listing by listing ID.",
    field: "listing_id",
    limit: 1
  });
}
