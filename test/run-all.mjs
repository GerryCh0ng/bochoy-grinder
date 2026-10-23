// Single entry point: `node test/run-all.mjs`.
// (`node --test` spawns child processes, which the DSH sandbox blocks.)
import "./manifest.test.mjs";
import "./plugin.test.mjs";
