import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

function parseAudiences(value) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
}

function parseScopes(value) {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\s]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function getAudience(payload) {
  if (Array.isArray(payload.aud)) {
    return payload.aud[0];
  }
  return payload.aud;
}

export function buildAuthInfo(payload, token) {
  const aud = getAudience(payload);
  const clientId = payload.azp || aud || "unknown";
  const scopes = Array.isArray(payload.roles)
    ? payload.roles.map(scope => String(scope))
    : parseScopes(payload.scp);
  const expiresAt = typeof payload.exp === "number" ? payload.exp : undefined;

  return {
    token,
    clientId,
    scopes,
    expiresAt,
    extra: payload
  };
}

export function createTokenVerifier() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const issuer = process.env.OAUTH_ISSUER ?? (tenantId
    ? `https://login.microsoftonline.com/${tenantId}/v2.0`
    : undefined);
  const audiences = parseAudiences(process.env.OAUTH_AUDIENCE ?? process.env.AZURE_CLIENT_ID);

  if (!issuer || !tenantId || audiences.length === 0) {
    throw new Error(
      "OAuth configuration missing. Set AZURE_TENANT_ID and OAUTH_AUDIENCE (or AZURE_CLIENT_ID)."
    );
  }

  const jwksUrl = new URL(
    process.env.OAUTH_JWKS_URL ?? `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
  );
  const jwks = createRemoteJWKSet(jwksUrl);

  return async function verifyAccessToken(token) {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: audiences
    });
    return buildAuthInfo(payload, token);
  };
}

export function createAuthMiddleware() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const issuer = process.env.OAUTH_ISSUER ?? (tenantId
    ? `https://login.microsoftonline.com/${tenantId}/v2.0`
    : undefined);
  const audiences = parseAudiences(process.env.OAUTH_AUDIENCE ?? process.env.AZURE_CLIENT_ID);

  if (!issuer || !tenantId || audiences.length === 0) {
    throw new Error(
      "OAuth configuration missing. Set AZURE_TENANT_ID and OAUTH_AUDIENCE (or AZURE_CLIENT_ID)."
    );
  }

  const jwksUrl = new URL(
    process.env.OAUTH_JWKS_URL ?? `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
  );
  const jwks = createRemoteJWKSet(jwksUrl);

  return async function authMiddleware(req, res, next) {
    if (req.method === "OPTIONS") {
      return next();
    }

    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) {
      if (process.env.OAUTH_LOG_TOKENS === "1") {
        console.info("OAuth request missing bearer token", {
          method: req.method,
          path: req.originalUrl ?? req.url
        });
      }
      req.auth = undefined;
      return next();
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      if (process.env.OAUTH_LOG_TOKENS === "1") {
        console.info("OAuth request empty bearer token", {
          method: req.method,
          path: req.originalUrl ?? req.url
        });
      }
      req.auth = undefined;
      return next();
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: audiences
      });
      req.auth = buildAuthInfo(payload, token);
      if (process.env.OAUTH_LOG_TOKENS === "1") {
        console.info("OAuth token validated", {
          method: req.method,
          path: req.originalUrl ?? req.url,
          aud: payload?.aud ?? null,
          iss: payload?.iss ?? null,
          scp: payload?.scp ?? null,
          roles: payload?.roles ?? null
        });
      }
      return next();
    } catch (error) {
      if (process.env.OAUTH_LOG_TOKENS === "1") {
        try {
          const payload = decodeJwt(token);
          console.warn("OAuth token validation failed", {
            message: error?.message ?? String(error),
            iss: payload?.iss ?? null,
            aud: payload?.aud ?? null,
            tid: payload?.tid ?? null,
            azp: payload?.azp ?? null,
            scp: payload?.scp ?? null,
            roles: payload?.roles ?? null
          });
        } catch (decodeError) {
          console.warn("OAuth token validation failed (decode error)", {
            message: error?.message ?? String(error),
            decode_error: decodeError?.message ?? String(decodeError)
          });
        }
      } else {
        console.warn("OAuth token validation failed:", error?.message ?? error);
      }
      req.auth = undefined;
      req.authError = { error: "invalid_token", error_description: "Access token is invalid." };
      return next();
    }
  };
}
