export const GH_API_BASE_URL = "https://api.github.com";
export const GH_AUTHORIZATION_BASE_URL = "https://github.com/login/oauth/authorize";
export const GH_TOKEN_URL = "https://github.com/login/oauth/access_token";

export const GH_APP_ID = process.env.GITHUB_APP_ID;
export const GH_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
export const GH_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
export const GH_PRIVATE_KEY = process.env.GITHUB_PRIVATE_KEY;
export const GH_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI;

export function getGitHubClientId() {
  if (!GH_CLIENT_ID) throw new Error("GITHUB_CLIENT_ID no configurado");
  return GH_CLIENT_ID;
}

export function getGitHubClientSecret() {
  if (!GH_CLIENT_SECRET) throw new Error("GITHUB_CLIENT_SECRET no configurado");
  return GH_CLIENT_SECRET;
}

export function getGitHubRedirectUri() {
  if (!GH_REDIRECT_URI) throw new Error("GITHUB_REDIRECT_URI no configurado");
  return GH_REDIRECT_URI;
}

