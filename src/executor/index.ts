// The gws subprocess executor is gone (ADR-103). What remains under executor/ is
// the local filesystem concerns that were never about the CLI: paths, and the
// workspace fence.
export { configDir, dataDir, credentialsDir, credentialPath, accountsFilePath, emailToSlug } from './paths.js';
