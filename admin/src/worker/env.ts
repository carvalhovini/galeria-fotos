export interface Env {
  BUCKET: R2Bucket;
  INBOX: R2Bucket;
  ASSETS: Fetcher;
  PUBLIC_R2_BASE_URL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  PURGE_ORIGINS: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
  GITHUB_REF: string;
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  GITHUB_TOKEN?: string;
  // Só para testes locais: aceitos apenas se apontarem para 127.0.0.1 ou localhost.
  CF_API_BASE?: string;
  GITHUB_API_BASE?: string;
}
