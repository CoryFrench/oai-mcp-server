import { createOAuthClientsStore, ensureOAuthSchema } from "./oauthStore.js";
import { createTokenVerifier } from "./auth.js";

function parseScopes(value) {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\s]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function shouldLogOAuth() {
  return process.env.OAUTH_LOG_TOKENS === "1";
}

function buildAuthUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

async function exchangeWithEntra(tokenUrl, body) {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body)
  });

  if (!response.ok) {
    const payload = await response.text();
    console.error("Entra token exchange failed", {
      status: response.status,
      body: payload?.slice(0, 500) ?? ""
    });
    throw new Error(`Entra token exchange failed: ${response.status} ${payload}`);
  }

  return response.json();
}

export async function createOAuthProvider(pool) {
  await ensureOAuthSchema(pool);
  const clientsStore = createOAuthClientsStore(pool);
  const verifyAccessToken = createTokenVerifier();
  const tenantId = process.env.AZURE_TENANT_ID;

  if (!tenantId) {
    throw new Error("AZURE_TENANT_ID is required for OAuth provider.");
  }

  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const authorizationEndpoint =
    process.env.OAUTH_AUTHORIZATION_URL ??
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
  const tokenEndpoint =
    process.env.OAUTH_TOKEN_URL ??
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const defaultScopes = parseScopes(
    process.env.OAUTH_SCOPES ?? process.env.AZURE_OAUTH_SCOPES
  );

  if (!clientId || !clientSecret) {
    throw new Error("AZURE_CLIENT_ID and AZURE_CLIENT_SECRET are required.");
  }

  return {
    clientsStore,
    skipLocalPkceValidation: true,
    async authorize(_client, params, res) {
      if (shouldLogOAuth()) {
        console.info("OAuth authorize request", {
          client_id: _client?.client_id ?? undefined,
          redirect_uri: params.redirectUri ?? undefined,
          scopes_count: params.scopes?.length ?? 0,
          has_code_challenge: Boolean(params.codeChallenge),
          state_len: params.state?.length ?? 0
        });
      }
      const scopeValue = params.scopes?.length ? params.scopes.join(" ") : defaultScopes.join(" ");
      const url = buildAuthUrl(authorizationEndpoint, {
        client_id: clientId,
        response_type: "code",
        redirect_uri: params.redirectUri,
        scope: scopeValue,
        code_challenge: params.codeChallenge,
        code_challenge_method: "S256",
        state: params.state,
        prompt: "login"
      });
      res.redirect(302, url.toString());
    },
    async challengeForAuthorizationCode() {
      throw new Error("Local PKCE validation is disabled.");
    },
    async exchangeAuthorizationCode(_client, authorizationCode, codeVerifier, redirectUri) {
      const scopeValue = defaultScopes.join(" ");
      return await exchangeWithEntra(tokenEndpoint, {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: authorizationCode,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        scope: scopeValue
      });
    },
    async exchangeRefreshToken(_client, refreshToken, scopes) {
      const scopeValue = scopes?.length ? scopes.join(" ") : defaultScopes.join(" ");
      return await exchangeWithEntra(tokenEndpoint, {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: scopeValue
      });
    },
    async verifyAccessToken(token) {
      return await verifyAccessToken(token);
    }
  };
}
