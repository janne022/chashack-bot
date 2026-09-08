/**
 * Registers slash commands with Discord, then exits.
 * Run after build: pnpm register:commands
 */
import { registerCommands } from './register-commands-lib.js';

await registerCommands();
process.exit(0);
