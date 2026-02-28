type EnvOverrides = Record<string, string>;

export const setTestEnv = (overrides: EnvOverrides = {}) => {
  Object.assign(process.env, {
    PORT: "3000",
    ROOT_USER: "root@example.com",
    ROOT_PASSWORD: "root",
    MYSQL_ROOT_PASSWORD: "root",
    HTSHADOW_PATH: "/etc/htshadow",
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3306",
    MYSQL_DATABASE: "wildfire_test",
    MYSQL_USER: "wildfire",
    MYSQL_PASSWORD: "wildfire",
    JWT_SECRET: "test-secret",
    DISPLAY_API_KEY: "display-api-key",
    ...overrides,
  });
};
