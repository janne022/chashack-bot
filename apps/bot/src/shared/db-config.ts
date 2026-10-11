export interface DatabaseConnection {
  host: string;
  port: number;
  user: string;
  password: string | undefined;
  database: string;
}

export function parseDatabaseUrl(value: string): DatabaseConnection {
  const input = value.trim();
  if (input === '') throw new Error('DATABASE_URL must not be empty');
  if (!input.includes('://')) {
    const fields = new Map<string, string>();
    for (const part of input.split(';')) {
      if (!part.trim()) continue;
      const at = part.indexOf('=');
      if (at < 1) throw new Error('Invalid ADO.NET database connection string');
      const key = part.slice(0, at).trim().toLowerCase();
      if (fields.has(key)) throw new Error(`Duplicate database connection field: ${key}`);
      fields.set(key, part.slice(at + 1).trim());
    }
    const get = (...keys: string[]): string | undefined => {
      const found = keys.flatMap((key) => fields.has(key) ? [fields.get(key)!] : []);
      if (found.length > 1) throw new Error(`Conflicting database connection fields: ${keys.join(', ')}`);
      return found[0];
    };
    const host = get('host', 'server', 'data source');
    const database = get('database', 'initial catalog');
    const user = get('username', 'user id', 'userid', 'user');
    const port = Number(get('port') ?? 5432);
    if (!host || !database || !user || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DATABASE_URL requires valid host, database, username, and port');
    return { host, port, user, password: get('password'), database };
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/' || url.hash) throw new Error('DATABASE_URL must be a PostgreSQL URL with a database name');
  const allowedOptions = new Set(['sslmode', 'application_name', 'connect_timeout', 'options']);
  if ([...url.searchParams.keys()].some((key) => !allowedOptions.has(key)) || [...new Set(url.searchParams.keys())].some((key) => url.searchParams.getAll(key).length > 1)) throw new Error('Invalid or ambiguous DATABASE_URL options');
  if (url.pathname.slice(1).includes('/')) throw new Error('DATABASE_URL must contain exactly one database name');
  const port = url.port === '' ? 5432 : Number(url.port);
  let database: string;
  let user: string;
  let password: string | undefined;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
    user = decodeURIComponent(url.username);
    password = url.password ? decodeURIComponent(url.password) : undefined;
  } catch {
    throw new Error('Invalid percent-encoding in DATABASE_URL');
  }
  if (!user || !database || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DATABASE_URL requires valid username, database, and port');
  return { host: url.hostname, port, user, password, database };
}
