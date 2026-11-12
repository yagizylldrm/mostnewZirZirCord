// Lets the app use the shared TypeScript packages from the monorepo while
// resolving every npm dependency from this app's own node_modules
// (React Native needs its own React version, separate from the web app's).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.join(monorepoRoot, 'packages')];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  '@zirzircord/shared': path.join(monorepoRoot, 'packages/shared'),
  '@zirzircord/client-core': path.join(monorepoRoot, 'packages/client-core'),
};
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
