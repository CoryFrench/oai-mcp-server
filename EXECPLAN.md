# Basic ChatGPT App (Apps SDK) Implementation Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan must be maintained in accordance with `./.codex/PLANS.md`.

## Purpose / Big Picture

The goal is to build a minimal, working ChatGPT app using the Apps SDK: a small MCP server that exposes tools and an optional web component UI rendered inside ChatGPT. After completing this plan, a user can run the MCP server locally, inspect and test its tools, and connect it to ChatGPT in developer mode using a public HTTPS URL to see the tool calls and UI working.

## Progress

- [x] (2026-01-23 14:47Z) Drafted the initial ExecPlan for a basic Apps SDK app.
- [ ] Set up the project structure and baseline files.
- [ ] Implement the MCP server with a simple tool set.
- [ ] Add the optional web component UI and wire it in.
- [ ] Validate with the MCP Inspector and ChatGPT developer mode.

## Surprises & Discoveries

No surprises yet. This will be updated once implementation starts.

## Decision Log

- Decision: Use Node.js with ESM, `@modelcontextprotocol/sdk`, and `zod`, plus a static HTML web component.
  Rationale: This matches the Apps SDK quickstart approach, minimizes build tooling, and keeps the example approachable.
  Date/Author: 2026-01-23 / Codex

## Outcomes & Retrospective

Not started. This section will summarize what was delivered and learned once implementation completes.

## Context and Orientation

This repository is currently empty aside from the `.codex` directory. We will create a simple, self-contained example app in the repo root with two main parts: a server and a UI. An MCP server is a small HTTP server that exposes "tools" (actions) in the Model Context Protocol so ChatGPT can call them. A tool is a named action with a JSON schema for input and a structured response. A web component is an HTML page that can be rendered in an iframe inside ChatGPT as the app's UI. The Apps SDK uses the MCP server for tool execution and optionally renders the UI if provided.

## Plan of Work

We will create a minimal directory layout: `server/` for the MCP server and `public/` for the UI. The server will be an ESM Node.js app that hosts an HTTP endpoint at `/mcp` using the MCP SDK's HTTP transport, plus a basic health check at `/`. The server will define two tools (for example, `todo.add` and `todo.list`) backed by in-memory state to keep the example simple. The UI will be a single HTML file under `public/` that can display and add items; it can call the tools through the Apps SDK runtime when rendered in ChatGPT, but for local testing it will still show a basic interface. We will provide instructions to test the server with the MCP Inspector and to connect it to ChatGPT in developer mode using a public HTTPS tunnel (such as ngrok) to expose `/mcp`.

## Concrete Steps

All commands are run from the repository root: `C:\Users\CoryFrench\OneDrive - Waterfront Prop & Club Comm\Documents\Projects\OpenAI App Test`.

Create folders and initialize the server package:

    mkdir server public
    cd server
    npm init -y
    npm pkg set type=module
    npm install @modelcontextprotocol/sdk zod

Create the MCP server entry point at `server/server.js` and keep it small and readable. The file should:

1) Start an HTTP server that listens on a configurable port (default `8787`).
2) Serve a health check at `GET /` returning 200 OK and a short body.
3) Route MCP requests at `/mcp` using `StreamableHTTPServerTransport`.
4) Include CORS headers and basic error handling for invalid requests.

Create a minimal tool server factory, for example `server/todoServer.js`, that returns an MCP server instance. It should define at least two tools with simple JSON schemas, for example:

    todo.add: input { "title": string }, output { "id": string, "title": string }
    todo.list: input {}, output { "items": [{ "id": string, "title": string }] }

Keep state in memory (an array) to avoid database dependencies in the first iteration.

Create the optional UI at `public/todo-widget.html` as a single HTML file with embedded CSS and JS. It should:

1) Render a list of items and a simple form.
2) Provide a placeholder state if the MCP runtime is not available.
3) Be small enough to load in an iframe within ChatGPT.

Expose the UI for local preview by adding a simple static file route in the server (optional), or by opening the HTML file directly in a browser. The MCP server remains required for the app to work in ChatGPT.

## Validation and Acceptance

Local validation should include:

1) Run the MCP server with:

    cd server
    node server.js

   Expect console output similar to:

    Todo MCP server listening on http://localhost:8787/mcp

2) Use the MCP Inspector to verify the tool schemas and responses:

    npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http

   In the browser UI, confirm that `todo.add` and `todo.list` appear and return structured results.

3) Expose the server via a public HTTPS URL (for example, ngrok):

    ngrok http 8787

   Use the HTTPS URL ending with `/mcp` when adding the connector in ChatGPT developer mode.

Acceptance is met when:

1) The MCP Inspector can call both tools successfully.
2) ChatGPT developer mode can connect to the `/mcp` URL and invoke a tool from a prompt.
3) The optional UI renders inside ChatGPT when enabled for the app.

## Idempotence and Recovery

These steps are safe to repeat. If the server fails to start, re-run `npm install` and confirm `server/package.json` has `"type": "module"`. If the MCP Inspector cannot connect, verify the port and `/mcp` path are correct and the server is running. If the ChatGPT connector cannot reach the server, confirm the public HTTPS tunnel is active and that the URL ends with `/mcp`.

## Artifacts and Notes

Include concise evidence in this section when implementing, such as:

    $ node server.js
    Todo MCP server listening on http://localhost:8787/mcp

    $ npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http
    (browser opens, tools list includes todo.add and todo.list)

## Interfaces and Dependencies

Dependencies for the server should include:

    @modelcontextprotocol/sdk (MCP server and HTTP transport)
    zod (schema validation for tool inputs)

Define the MCP server factory in `server/todoServer.js` with a signature similar to:

    export function createTodoServer() { /* returns MCP server instance */ }

In `server/server.js`, use `StreamableHTTPServerTransport` with the `/mcp` path and connect it to the MCP server instance. The HTTP server must accept `GET`, `POST`, and `DELETE` for the MCP route and set `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: Mcp-Session-Id` so the inspector and ChatGPT can connect.
