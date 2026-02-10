import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

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
  const UTILS_LIST_DEVELOPMENTS = "utils.list_developments";
  const TAX_LIST_LAND_USE_DESCRIPTIONS = "tax.list_land_use_descriptions";
  const TAX_LIST_CONDO_DESCRIPTIONS = "tax.list_condo_descriptions";

  server.registerTool(
    "db.ping",
    {
      description: "Run a simple query to verify database connectivity.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
    UTILS_LIST_DEVELOPMENTS,
    {
      description:
        "List distinct MLS development names, optionally filtered by a partial match.",
      inputSchema: z.object({
        search: z.string().trim().min(1).max(100).optional(),
        match: z.enum(["contains", "prefix"]).default("contains"),
        limit: z.number().int().min(1).max(2000).default(500)
      }),
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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

  return server;
}
