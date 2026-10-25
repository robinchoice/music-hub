// Compiles the CLI into one file named like the app (README, „CLI“), with the
// address of the live app baked in. APP_URL from the environment overrides it.
// Further arguments go to bun build, such as --target=bun-darwin-arm64.
import { $ } from 'bun';
import { LIVE_URL, SLUG } from './src/config';

const url = process.env.CLI_URL || LIVE_URL;
await $`bun build src/main.ts --compile --minify --outfile build/${SLUG} --define process.env.CLI_URL=${JSON.stringify(url)} ${process.argv.slice(2)}`;
