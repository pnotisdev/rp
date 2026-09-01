/** For sub-resources nested inside a JSON blob (e.g. an objective's tasks) that never get their own POST endpoint — everything else gets its id assigned by the server on create. */
export function newId(): string {
  return crypto.randomUUID()
}
