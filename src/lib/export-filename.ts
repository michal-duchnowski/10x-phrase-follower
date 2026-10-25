/** Filesystem-safe UTC timestamp and random suffix distinguish repeated exports. */
export function createExportFilename(name: string): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return `${name}-${timestamp}-${crypto.randomUUID().slice(0, 8)}.md`;
}
