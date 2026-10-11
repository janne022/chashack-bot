/** Call before connecting to any destructive fixture or recovery destination. */
export function assertDisposableDatabase(name: string): void {
  if (!/^.+_(?:test|ci)$/.test(name) || /[\r\n]/.test(name)) throw new Error('Destructive database operations require a name ending in _test or _ci');
}
