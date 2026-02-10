import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { createPoolFromEnv } from "./db.js";
import { createMcpServer } from "./mcpServer.js";
import { createAuthMiddleware } from "./auth.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { createOAuthProvider } from "./oauthProvider.js";
import { createAuthAuditMiddleware } from "./authAudit.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const allowedHosts = process.env.MCP_ALLOWED_HOSTS
  ? process.env.MCP_ALLOWED_HOSTS.split(",").map(host => host.trim()).filter(Boolean)
  : null;
const app = createMcpExpressApp(
  allowedHosts ? { allowedHosts: ["localhost", "127.0.0.1", "::1", ...allowedHosts] } : undefined
);
app.set("trust proxy", 1);
const pool = createPoolFromEnv();
const authMiddleware = createAuthMiddleware();
const authAuditMiddleware = await createAuthAuditMiddleware(pool);
const { oauthMetadata, scopesSupported } = buildOAuthMetadata();
const resourceServerUrl = getResourceServerUrl();
const issuerUrl = new URL(process.env.OAUTH_ISSUER_URL ?? "https://services.waterfront-ai.com");
const baseUrl = new URL(process.env.OAUTH_BASE_URL ?? issuerUrl.href);
const oauthProvider = await createOAuthProvider(pool);

app.use("/token", express.urlencoded({ extended: false }));
app.use("/token", (req, res, next) => {
  const start = Date.now();
  const authHeader = req.headers.authorization ?? "";
  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex > -1) {
      const clientId = decoded.slice(0, separatorIndex);
      const clientSecret = decoded.slice(separatorIndex + 1);
      req.body = {
        ...(req.body ?? {}),
        client_id: req.body?.client_id ?? clientId,
        client_secret: req.body?.client_secret ?? clientSecret
      };
    }
  }
  if (process.env.OAUTH_LOG_TOKENS === "1") {
    const bodyKeys = Object.keys(req.body ?? {});
    console.info("OAuth token request", {
      hasAuthHeader: Boolean(req.headers.authorization),
      contentType: req.headers["content-type"] ?? null,
      bodyKeys
    });
    res.on("finish", () => {
      const body = req.body ?? {};
      console.info("OAuth token response", {
        status: res.statusCode,
        duration_ms: Date.now() - start,
        grant_type: body.grant_type ?? null,
        has_client_id: Boolean(body.client_id),
        has_client_secret: Boolean(body.client_secret)
      });
    });
  }
  next();
});

app.use(
  mcpAuthRouter({
    issuerUrl,
    baseUrl,
    provider: oauthProvider,
    resourceServerUrl,
    scopesSupported,
    resourceName: "Waterfront AI MCP"
  })
);

function parseScopes(value) {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\s]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function buildOAuthMetadata() {
  const tenantId = process.env.AZURE_TENANT_ID;
  if (!tenantId) {
    throw new Error("AZURE_TENANT_ID is required for OAuth metadata.");
  }

  const issuer =
    process.env.OAUTH_ISSUER ?? `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const authorizationEndpoint =
    process.env.OAUTH_AUTHORIZATION_URL ??
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
  const tokenEndpoint =
    process.env.OAUTH_TOKEN_URL ??
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const scopesSupported = parseScopes(
    process.env.OAUTH_SCOPES ?? process.env.AZURE_OAUTH_SCOPES
  );

  return {
    oauthMetadata: {
      issuer,
      authorization_endpoint: authorizationEndpoint,
      token_endpoint: tokenEndpoint,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
        "none"
      ],
      grant_types_supported: ["authorization_code", "refresh_token"],
      scopes_supported: scopesSupported
    },
    scopesSupported
  };
}

function getResourceServerUrl() {
  const fallback = "https://services.waterfront-ai.com/oai-app";
  return new URL(process.env.MCP_PUBLIC_URL ?? fallback);
}

function setMcpHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.options("/mcp", (req, res) => {
  setMcpHeaders(res);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.sendStatus(204);
});

app.use("/mcp", authMiddleware);
app.use("/mcp", authAuditMiddleware);

app.post("/mcp", async (req, res) => {
  setMcpHeaders(res);
  const server = createMcpServer(pool);

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  }
});

app.get("/mcp", (req, res) => {
  setMcpHeaders(res);
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  });
});

app.delete("/mcp", (req, res) => {
  setMcpHeaders(res);
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  });
});

app.listen(Number.isNaN(port) ? 8787 : port, error => {
  if (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
  console.log(`MCP server listening on http://localhost:${Number.isNaN(port) ? 8787 : port}/mcp`);
});

process.on("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});
