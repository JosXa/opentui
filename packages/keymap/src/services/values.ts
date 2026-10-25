function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const NOT_PLAIN_DATA = Symbol("not plain data")
const FUNCTION_DATA = Symbol("function")
const PLAIN_DATA_DEPTH_MAX = 16
const PLAIN_FUNCTION_KEYS = new Set<PropertyKey>(["length", "name", "prototype"])

// Copies plain data for a later `samePlainData`, with every function as one marker. Plain data is plain
// objects, arrays and primitives with enumerable string-keyed data properties, and functions with no own
// properties of their own. Anything else (other prototypes, frozen, sealed or non-extensible objects,
// accessors, symbol or non-enumerable keys, data deeper than 16) returns `NOT_PLAIN_DATA`. A proxy cannot be
// told apart portably; one that behaves as plain data is read as plain data, and nothing is written to it.
export function snapshotPlainData(value: unknown, depth = 0): unknown {
  if (typeof value === "function") {
    return Reflect.ownKeys(value).every((key) => PLAIN_FUNCTION_KEYS.has(key)) ? FUNCTION_DATA : NOT_PLAIN_DATA
  }
  if (typeof value !== "object" || value === null) return value

  const isArray = Array.isArray(value)
  const plain = isArray ? Object.getPrototypeOf(value) === Array.prototype : isPlainObject(value)
  if (!plain || !Object.isExtensible(value) || depth >= PLAIN_DATA_DEPTH_MAX) return NOT_PLAIN_DATA

  const copy = (isArray ? [] : {}) as Record<string, unknown>
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== "string" || !("value" in descriptor)) return NOT_PLAIN_DATA
    if (!descriptor.enumerable && !(isArray && key === "length")) return NOT_PLAIN_DATA
    const entry = snapshotPlainData(descriptor.value, depth + 1)
    if (entry === NOT_PLAIN_DATA) return NOT_PLAIN_DATA
    copy[key] = entry
  }

  return copy
}

// Compares two `snapshotPlainData` copies; values outside them (targets, registries) compare by identity.
export function samePlainData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!isPlainContainer(left) || !isPlainContainer(right) || Array.isArray(left) !== Array.isArray(right)) {
    return false
  }

  const keys = Reflect.ownKeys(left) as string[]
  return (
    keys.length === Reflect.ownKeys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && samePlainData(left[key], right[key]))
  )
}

function isPlainContainer(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && (Array.isArray(value) || isPlainObject(value))
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

export function isPromiseLike(value: unknown): value is Promise<unknown> {
  if (!value) {
    return false
  }

  if (typeof value !== "object" && typeof value !== "function") {
    return false
  }

  return typeof (value as { then?: unknown }).then === "function"
}

export function snapshotDataValue(
  value: unknown,
  options?: {
    deep?: boolean
    freeze?: boolean
    preserveNonPlainObjects?: boolean
  },
): unknown {
  const deep = options?.deep === true
  const freeze = options?.freeze === true
  const preserveNonPlainObjects = options?.preserveNonPlainObjects === true

  if (Array.isArray(value)) {
    const cloned = deep ? value.map((entry) => snapshotDataValue(entry, options)) : [...value]
    return freeze ? Object.freeze(cloned) : cloned
  }

  if (value && typeof value === "object") {
    if (preserveNonPlainObjects && !isPlainObject(value)) {
      return value
    }

    const cloned: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      cloned[key] = deep ? snapshotDataValue(entry, options) : entry
    }

    return freeze ? Object.freeze(cloned) : cloned
  }

  return value
}
