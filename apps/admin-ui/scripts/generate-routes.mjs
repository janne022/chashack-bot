import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Use the generator already pinned by our installed router plugin. Never fetch
// an unreviewed CLI during a build or bypass the workspace release cooldown.
const requireFromPlugin = createRequire(import.meta.resolve('@tanstack/router-plugin'));
const { Generator, getConfig } = requireFromPlugin('@tanstack/router-generator');
const root = fileURLToPath(new URL('../', import.meta.url));
const config = getConfig({
  target: 'react',
  routesDirectory: './src/routes',
  generatedRouteTree: './src/routeTree.gen.ts',
}, root);
await new Generator({ config, root }).run();
