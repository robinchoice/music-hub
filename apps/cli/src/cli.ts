import { parseArgs } from 'node:util';
import { createClient } from './client';
import { type Command, EXIT, Failure, type Io, type Result } from './command';
import { auth } from './commands/auth';
import { board } from './commands/board';
import { deliveries } from './commands/deliveries';
import { plan } from './commands/plan';
import { projects } from './commands/projects';
import { share } from './commands/share';
import { DEFAULT_URL, loadSession, SLUG } from './config';
import { texts } from './texts';

// Every command of the CLI. A new one goes in here (README, „CLI“).
export const commands: Record<string, Command> = { ...auth, projects, board, share, deliveries, plan };

const globalOptions = {
  json: { type: 'boolean' },
  url: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

// For --json the same lines as data, so agents read the commands too
function help(): Result {
  const rows = Object.values(commands).flatMap((command) => command.help);
  const options: [string, string][] = [
    ['--json', texts.jsonHelp],
    ['--url <url>', texts.urlHelp(DEFAULT_URL)],
    ['-h, --help', texts.helpHelp],
  ];
  const width = Math.max(...[...rows, ...options].map(([usage]) => usage.length)) + 2;
  const table = (list: [string, string][]) => list.map(([usage, text]) => `  ${usage.padEnd(width)}${text}`);
  const text = [
    `${SLUG} – ${texts.intro}`,
    '',
    texts.usage(SLUG),
    '',
    `${texts.commands}:`,
    ...table(rows),
    '',
    `${texts.options}:`,
    ...table(options),
    '',
    texts.exitCodes,
  ].join('\n');
  const lines = (list: [string, string][]) => list.map(([usage, text]) => ({ usage, text }));
  return { data: { commands: lines(rows), options: lines(options), exitCodes: EXIT }, text };
}

const isParseError = (error: unknown): error is TypeError =>
  error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS');

// `musichub <command> [options]`. With --json, stdout holds exactly one JSON
// value, the result or { error }; the exit code tells which (EXIT).
export async function run(args: string[], io: Io): Promise<number> {
  let json = args.includes('--json');
  try {
    const [name = '', ...rest] = args;
    const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
    if (name && !command && !name.startsWith('-')) throw new Failure(texts.unknownCommand(name, SLUG), EXIT.usage);
    const { values, positionals } = parseArgs({
      args: command ? rest : args,
      options: { ...globalOptions, ...command?.options },
      allowPositionals: command?.positionals === true,
    });
    json = values.json === true;
    if (!command && !values.help && args.length > 0) throw new Failure(texts.usage(SLUG), EXIT.usage);

    // The address of the last login, unless --url names another
    const stored = await loadSession(io.env);
    const url = (typeof values.url === 'string' ? values.url : (stored?.url ?? DEFAULT_URL)).replace(/\/+$/, '');
    const session = stored?.url === url ? stored : null;
    const api = createClient(url, session?.token);
    const result = command && !values.help ? await command.run({ api, url, session, values, positionals, io }) : help();
    io.out(json ? JSON.stringify(result.data, null, 2) : result.text);
    return EXIT.ok;
  } catch (error) {
    let failure: Failure;
    if (error instanceof Failure) failure = error;
    else if (isParseError(error)) failure = new Failure(texts.badOptions(error.message, SLUG), EXIT.usage);
    // Anything else, such as a config folder that can't be written
    else failure = new Failure(error instanceof Error ? error.message : String(error), EXIT.error);
    if (json) io.out(JSON.stringify({ error: failure.message }));
    else io.err(failure.message);
    return failure.exitCode;
  }
}
