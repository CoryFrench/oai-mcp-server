import crypto from "crypto";

function getFirstForwardedIp(value) {
  if (!value) {
    return null;
  }
  const [first] = value.split(",");
  return first?.trim() || null;
}

function normalizeAudience(aud) {
  if (Array.isArray(aud)) {
    return aud[0] ?? null;
  }
  return aud ?? null;
}

function normalizeRoles(roles) {
  if (!roles) {
    return null;
  }
  return Array.isArray(roles) ? roles.map(String) : [String(roles)];
}

function normalizeScopes(scopes, scp) {
  if (Array.isArray(scopes) && scopes.length) {
    return scopes.map(String);
  }
  if (!scp) {
    return null;
  }
  return String(scp)
    .split(/[,\s]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createAuthAuditMiddleware(pool) {
  await pool.query(`
    create schema if not exists mcp_auth;

    create table if not exists mcp_auth.oauth_signins (
      id bigserial primary key,
      oid text,
      upn text,
      tid text,
      aud text,
      iss text,
      client_id text,
      scopes text[],
      roles text[],
      method text,
      path text,
      user_agent text,
      ip text,
      created_at timestamptz not null default now()
    );
  `);

  const seenTokens = new Map();
  const dedupeMs = 10 * 60 * 1000;

  return async function authAuditMiddleware(req, _res, next) {
    if (process.env.OAUTH_AUDIT_LOG === "0") {
      return next();
    }

    const authInfo = req.auth;
    if (!authInfo?.token) {
      return next();
    }

    const tokenHash = hashToken(authInfo.token);
    const now = Date.now();
    const lastSeen = seenTokens.get(tokenHash);
    if (lastSeen && now - lastSeen < dedupeMs) {
      return next();
    }
    seenTokens.set(tokenHash, now);
    if (seenTokens.size > 1000) {
      seenTokens.clear();
    }

    const payload = authInfo.extra ?? {};
    const scopes = normalizeScopes(authInfo.scopes, payload.scp);
    const roles = normalizeRoles(payload.roles);
    const aud = normalizeAudience(payload.aud);
    const ip = getFirstForwardedIp(req.headers["x-forwarded-for"]) ??
      req.socket?.remoteAddress ??
      null;

    try {
      await pool.query(
        `
        insert into mcp_auth.oauth_signins (
          oid,
          upn,
          tid,
          aud,
          iss,
          client_id,
          scopes,
          roles,
          method,
          path,
          user_agent,
          ip
        ) values (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12
        )
        `,
        [
          payload.oid ?? payload.sub ?? null,
          payload.preferred_username ?? payload.upn ?? payload.email ?? null,
          payload.tid ?? null,
          aud,
          payload.iss ?? null,
          authInfo.clientId ?? null,
          scopes,
          roles,
          req.method,
          req.originalUrl ?? req.url,
          req.headers["user-agent"] ?? null,
          ip
        ]
      );
    } catch (error) {
      console.warn("OAuth sign-in audit failed:", error?.message ?? error);
    }

    return next();
  };
}
