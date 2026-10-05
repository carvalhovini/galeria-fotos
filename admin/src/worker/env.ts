export interface Env {
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  PUBLIC_R2_BASE_URL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  PURGE_ORIGINS: string;
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  // Só para testes locais: aceito apenas se apontar para 127.0.0.1 ou localhost.
  CF_API_BASE?: string;
}
