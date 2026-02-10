import crypto from "crypto";

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function generateClientSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function shouldLogOAuth() {
  return process.env.OAUTH_LOG_TOKENS === "1";
}

function normalizeClientMetadata(client) {
  return {
    redirect_uris: client.redirect_uris,
    token_endpoint_auth_method: client.token_endpoint_auth_method ?? "client_secret_post",
    grant_types: client.grant_types ?? ["authorization_code", "refresh_token"],
    response_types: client.response_types ?? ["code"],
    client_name: client.client_name ?? undefined,
    client_uri: client.client_uri ?? undefined,
    logo_uri: client.logo_uri ?? undefined,
    scope: client.scope ?? undefined,
    contacts: client.contacts ?? undefined,
    tos_uri: client.tos_uri ?? undefined,
    policy_uri: client.policy_uri ?? undefined,
    jwks_uri: client.jwks_uri ?? undefined,
    jwks: client.jwks ?? undefined,
    software_id: client.software_id ?? undefined,
    software_version: client.software_version ?? undefined,
    software_statement: client.software_statement ?? undefined
  };
}

function stripNullish(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined)
  );
}

function mapRowToClient(row) {
  if (!row) {
    return undefined;
  }

  return {
    client_id: row.client_id,
    client_secret: row.client_secret ?? undefined,
    client_id_issued_at: row.client_id_issued_at ?? undefined,
    client_secret_expires_at: row.client_secret_expires_at ?? undefined,
    redirect_uris: row.redirect_uris ?? [],
    token_endpoint_auth_method: row.token_endpoint_auth_method ?? undefined,
    grant_types: row.grant_types ?? undefined,
    response_types: row.response_types ?? undefined,
    client_name: row.client_name ?? undefined,
    client_uri: row.client_uri ?? undefined,
    logo_uri: row.logo_uri ?? undefined,
    scope: row.scope ?? undefined,
    contacts: row.contacts ?? undefined,
    tos_uri: row.tos_uri ?? undefined,
    policy_uri: row.policy_uri ?? undefined,
    jwks_uri: row.jwks_uri ?? undefined,
    jwks: row.jwks ?? undefined,
    software_id: row.software_id ?? undefined,
    software_version: row.software_version ?? undefined,
    software_statement: row.software_statement ?? undefined
  };
}

export async function ensureOAuthSchema(pool) {
  await pool.query(`
    create schema if not exists mcp_auth;

    create table if not exists mcp_auth.oauth_clients (
      client_id text primary key,
      client_secret text,
      client_id_issued_at integer,
      client_secret_expires_at integer,
      redirect_uris text[] not null,
      token_endpoint_auth_method text,
      grant_types text[],
      response_types text[],
      client_name text,
      client_uri text,
      logo_uri text,
      scope text,
      contacts text[],
      tos_uri text,
      policy_uri text,
      jwks_uri text,
      jwks jsonb,
      software_id text,
      software_version text,
      software_statement text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
}

export function createOAuthClientsStore(pool) {
  return {
    async getClient(clientId) {
      const result = await pool.query(
        `
        select *
        from mcp_auth.oauth_clients
        where client_id = $1
        `,
        [clientId]
      );
      const client = mapRowToClient(result.rows[0]);
      if (!client && shouldLogOAuth()) {
        console.warn("OAuth client not found", { clientId });
      }
      return client;
    },
    async registerClient(client) {
      const normalized = normalizeClientMetadata(client);
      const clientId = client.client_id ?? crypto.randomUUID();
      const issuedAt = client.client_id_issued_at ?? nowEpochSeconds();
      const clientSecret =
        client.client_secret ??
        (normalized.token_endpoint_auth_method === "none" ? undefined : generateClientSecret());
      const clientSecretExpiresAt =
        client.client_secret_expires_at ?? (clientSecret ? null : undefined);

      await pool.query(
        `
        insert into mcp_auth.oauth_clients (
          client_id,
          client_secret,
          client_id_issued_at,
          client_secret_expires_at,
          redirect_uris,
          token_endpoint_auth_method,
          grant_types,
          response_types,
          client_name,
          client_uri,
          logo_uri,
          scope,
          contacts,
          tos_uri,
          policy_uri,
          jwks_uri,
          jwks,
          software_id,
          software_version,
          software_statement
        ) values (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18, $19, $20
        )
        `,
        [
          clientId,
          clientSecret ?? null,
          issuedAt,
          clientSecretExpiresAt ?? null,
          normalized.redirect_uris,
          normalized.token_endpoint_auth_method,
          normalized.grant_types,
          normalized.response_types,
          normalized.client_name,
          normalized.client_uri,
          normalized.logo_uri,
          normalized.scope,
          normalized.contacts,
          normalized.tos_uri,
          normalized.policy_uri,
          normalized.jwks_uri,
          normalized.jwks,
          normalized.software_id,
          normalized.software_version,
          normalized.software_statement
        ]
      );

      if (shouldLogOAuth()) {
        console.info("OAuth client registered", {
          client_id: clientId,
          token_endpoint_auth_method: normalized.token_endpoint_auth_method,
          redirect_uris_count: normalized.redirect_uris.length,
          has_client_secret: Boolean(clientSecret)
        });
      }

      return stripNullish({
        ...normalized,
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: issuedAt,
        client_secret_expires_at: clientSecretExpiresAt ?? undefined
      });
    }
  };
}
