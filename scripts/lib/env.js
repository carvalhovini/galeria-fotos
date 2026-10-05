import path from 'node:path';
import { ROOT_DIR } from './config.js';

export function loadEnvFile() {
  try {
    process.loadEnvFile(path.join(ROOT_DIR, '.env'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Mensagens de erro citam só os nomes das variáveis, nunca os valores.
export function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Variáveis ausentes ou vazias no .env: ${missing.join(', ')}. Veja os nomes em .env.example.`,
    );
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name].trim()]));
}
