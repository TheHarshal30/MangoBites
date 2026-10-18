import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.PORT ?? 4000);

/**
 * Base URL other parties use to reach this server. Defaults to localhost; set it to an
 * ngrok/LAN URL when a phone running Inji Wallet must reach the playground issuer/verifier.
 */
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');

/**
 * Base URL that services running inside Docker (Inji Verify, Inji Certify) use to reach this
 * server, e.g. to resolve an issuer's did:web / JWKS. host.docker.internal works on Docker Desktop.
 */
export const DOCKER_REACHABLE_BASE_URL = (process.env.DOCKER_REACHABLE_BASE_URL ?? `http://host.docker.internal:${PORT}`).replace(/\/$/, '');

export const INJI_CERTIFY_URL = (process.env.INJI_CERTIFY_URL ?? 'http://localhost:8090').replace(/\/$/, '');
export const INJI_VERIFY_URL = (process.env.INJI_VERIFY_URL ?? 'http://localhost:8082').replace(/\/$/, '');

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(here, '..', 'data');
export const WEB_DIST_DIR = path.resolve(here, '..', '..', 'web', 'dist');
