# Expand MCP SQL Tools With Narrow Read-Only Endpoints

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan must be maintained in accordance with `./.codex/PLANS.md`.

## Purpose / Big Picture

The goal is to expand the MCP server with a larger catalog of small, narrow, read-only SQL tools that are safe for AI use. After completing this plan, a user can connect the MCP server to ChatGPT and reliably call focused tools (for example, list lookups and fixed-scope summaries) without a sprawling, error-prone mega endpoint. The result should be easier to validate, less risky to use in developer mode, and more predictable for the model when selecting tools.

## Progress

- [x] (2026-02-10 15:55Z) Read `.codex/AGENTS.md` and `.codex/PLANS.md`.
- [x] (2026-02-10 16:00Z) Reviewed OpenAI guidance on MCP apps and tool safety to inform the plan.
- [x] (2026-02-10 17:05Z) Drafted and approved the initial tool catalog for tax lookups and MLS list endpoints.
- [x] (2026-02-10 17:20Z) Implemented narrow tax lookup tools and added safety annotations to all tools.
- [x] (2026-02-10 18:20Z) Implemented IRS migration tools with FIPS helpers and AGI-by-ZIP lookup.
- [x] (2026-02-10 18:45Z) Normalized IRS state inputs and loosened county matching to support abbreviations.
- [x] (2026-02-10 19:10Z) Added FRED series search and observations tools for API-backed series lookup.
- [x] (2026-02-10 20:40Z) Implemented MLS metrics tools (counts, medians, DOM, new listings, under contract, and listing lookups).
- [x] (2026-02-17 15:10Z) Added MLS top-sales tools for development/city/zip with since/between variants, compact row output, and strict count/date validation.
- [ ] Validate tools via MCP Inspector and in ChatGPT developer mode.

## Surprises & Discoveries

- Observation: OpenAI app guidance requires setting readOnlyHint, destructiveHint, and openWorldHint for all tools; mislabeling can cause validation issues or disabling.
  Evidence: See OpenAI Help Center guidance referenced in the research notes.

- Observation: IRS county/state views store full state names (e.g., "Florida"), so state abbreviations like "FL" will not match without normalization.
  Evidence: `irs.vw_countyinflow` uses destination_state = "Florida" for Palm Beach County.

## Decision Log

- Decision: Favor many small read-only tools with fixed scopes and bounded limits rather than one generalized query tool.
  Rationale: Narrow tools reduce model error, allow precise descriptions, and improve tool selection predictability.
  Date/Author: 2026-02-10 / Codex

- Decision: Require explicit safety annotations on all tools (readOnlyHint, destructiveHint) and keep descriptions concise. Also set openWorldHint to false to avoid "open world" labeling.
  Rationale: Aligns with OpenAI app review guidance for readOnlyHint/destructiveHint and improves app UX in ChatGPT.
  Date/Author: 2026-02-10 / Codex

- Decision: Use contains matching for situs address lookups and exact case-insensitive matching for group name filters.
  Rationale: Address input is often partial or formatted inconsistently, while development/region/zone/subdivision values should be precise.
  Date/Author: 2026-02-10 / Codex

- Decision: Use IRS views for migration data and add FIPS helpers for city/state lookups.
  Rationale: Views provide human-friendly fields while FIPS helpers resolve ambiguous inputs without exposing raw table complexity to the model.
  Date/Author: 2026-02-10 / Codex

- Decision: Use FRED series search tools so the model can discover series IDs before requesting observations.
  Rationale: Reduces reliance on memorized series IDs and keeps tools narrow and error-resistant.
  Date/Author: 2026-02-10 / Codex

## Outcomes & Retrospective

Not started. This section will summarize what was delivered and learned once implementation completes.

## Context and Orientation

This repo contains an MCP server under `server/` that exposes tools backed by PostgreSQL. The tool catalog is defined in `server/mcpServer.js` using `McpServer.registerTool`, with `zod` schemas for inputs. The server entry point is `server/server.js`, which wires the MCP HTTP transport and OAuth middleware. Database access is via `server/db.js`, which builds a `pg` pool using environment variables from `oai_app/.env`.

This plan focuses only on read-only SQL access. A "tool" is a named MCP action with a small, well-defined input schema and a response payload that returns data as JSON text. The tools must be narrow, with minimal parameters, and safe to repeat.

## Plan of Work

First, inventory the data sources we intend to expose and select a tool catalog that is intentionally small but covers common lookups and fixed-scope summaries. The catalog should be split into thematic prefixes (for example, `mls.*`, `tax.*`, `utils.*`, `market_trends.*`) and each tool should map to one query with a narrow, explicit purpose.

Next, implement the tool catalog in `server/mcpServer.js`. Each tool must:

1) Use a small input schema with bounded parameters only (for example, optional `limit` with a hard max).
2) Query a single table or a small fixed join.
3) Return a compact response shape (count, limit, and rows/values).
4) Include `annotations.readOnlyHint = true`, `annotations.destructiveHint = false`, and `annotations.openWorldHint = false`.

Add a focused set of tools in these categories:

- MLS lookups: list distinct cities, counties, zip codes, parcel types, statuses, and subdivisions.
- MLS fixed-window summaries: small tools like "recent sales last 30 days by city" or "active listings count by city", each with a single, fixed time window and limited parameters.
- Tax lookups: land use descriptions, condo classification descriptions, and narrow parcel lookups from `tax.vw_palmbeach_full`.
- IRS migration: state/county inflow/outflow via `irs.vw_stateinflow`, `irs.vw_stateoutflow`, `irs.vw_countyinflow`, `irs.vw_countyoutflow` plus AGI by ZIP from `irs.agi_zip`.
- FRED API: series search, observations, and tag search for series ID discovery.
- Utilities: development names from `waterfrontdata.development_data` with optional prefix or contains filters and strict limits.

Avoid creating any tool that accepts arbitrary SQL, column names, or wide filter sets. Each tool should be a single-purpose query, with safe defaults and explicit bounds. Keep descriptions short and precise so the model can select the correct tool.

## Concrete Steps

All commands are run from the repo root: `C:\Users\WaterfrontAI\Documents\Repos\microservices-platform`.

1) Review available columns to validate tool query fields:

    cd oai_app
    "C:\Program Files\PostgreSQL\17\bin\psql.exe" -c "select column_name from information_schema.columns where table_schema='mls' and table_name='beaches_residential' order by ordinal_position;"
    "C:\Program Files\PostgreSQL\17\bin\psql.exe" -c "select column_name from information_schema.columns where table_schema='tax' and table_name='palmbeach_parcel' order by ordinal_position;"
    "C:\Program Files\PostgreSQL\17\bin\psql.exe" -c "select column_name from information_schema.columns where table_schema='tax' and table_name='palmbeach_condo' order by ordinal_position;"

2) Edit `oai_app/server/mcpServer.js` to add new tools with narrow schemas, bounded limits, and safety annotations.

3) Ensure all tools include `annotations` with `readOnlyHint: true`, `destructiveHint: false`, and `openWorldHint: false`.

4) Rebuild and redeploy the MCP server Docker image before any testing:

    cd C:\Users\WaterfrontAI\Documents\Repos\microservices-platform
    docker compose build oai-app
    docker compose up -d oai-app

5) Reconnect the ChatGPT app to refresh the tool catalog.

## Validation and Acceptance

Validation must show the tools are callable and safe, using the Dockerized MCP server:

1) Rebuild and redeploy the MCP server container (required before testing):

    cd C:\Users\WaterfrontAI\Documents\Repos\microservices-platform
    docker compose build oai-app
    docker compose up -d oai-app

2) Use the MCP Inspector to verify tool schemas and example calls:

    npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http

3) In ChatGPT developer mode, reconnect the app and confirm:

    - The new tools appear and are not marked destructive.
    - Each tool call returns expected JSON payloads.
    - No tool has broad, unbounded input parameters.

Acceptance is met when:

1) The tool list contains all catalog items defined above.
2) Every tool is marked read-only, non-destructive, and closed-world.
3) Each tool can be called with default parameters and returns results without errors.

## Idempotence and Recovery

These steps are safe to repeat. If a tool schema change does not appear in ChatGPT, restart the MCP server and re-add the connector. If a query fails, verify column names using the schema queries above and adjust the tool definition.

## Artifacts and Notes

Include brief command transcripts as evidence during implementation, for example:

    $ node server.js
    MCP server listening on http://localhost:8787/mcp

    $ npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http
    (browser opens; tool list shows mls.list_cities, tax.list_land_use_descriptions, utils.list_developments, etc.)

## Interfaces and Dependencies

The MCP server is implemented in `oai_app/server/mcpServer.js` using `@modelcontextprotocol/sdk/server/mcp.js` and `zod`. Each tool must keep the same handler signature as existing tools:

    server.registerTool("tool.name", { description, inputSchema, annotations, _meta }, async (args, extra) => { ... })

Database access is through the `pg` pool created in `oai_app/server/db.js`. Do not introduce new dependencies unless necessary. Keep queries parameterized and avoid dynamic SQL.
