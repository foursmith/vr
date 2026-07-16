export type ValueUpdate<T> = T | ((current: T) => T)

export const resolveValueUpdate = <T>(current: T, update: ValueUpdate<T>) =>
  typeof update === "function" ? (update as (current: T) => T)(current) : update
