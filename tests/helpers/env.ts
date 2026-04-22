type EnvOverrides = Record<string, string>;

/**
 * Apply caller-supplied env overrides on top of the preload baseline.
 *
 * Preload defaults live in `tests/helpers/preload-env.ts` (registered via
 * `bunfig.toml`) and are applied once per test run. This helper is only for
 * integration tests that need to override specific values (e.g. swapping in
 * the real MySQL coordinates from `getIntegrationMySqlEnv`). It MUST NOT
 * redefine preload defaults - doing so risks silently overwriting a valid
 * preload value with a stale local copy.
 */
export const setTestEnv = (overrides: EnvOverrides = {}) => {
  Object.assign(process.env, overrides);
};
