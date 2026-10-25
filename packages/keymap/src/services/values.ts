function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const NOT_PLAIN_DATA = Symbol("not plain data")
const DEPTH_MAX = 16
// Compiled data nests the copied data a few levels deeper; the bound only stops cycles a compile hook made.
const COMPILED_DEPTH_MAX = 32
const PLAIN_FUNCTION_KEYS = new Set<PropertyKey>(["length", "name", "prototype"])

// Copies plain data, reading every value once through the object, so a caller can compile from the copy
// instead of reading the original again. Plain data is plain objects, arrays and primitives with enumerable
// string-keyed data properties, and functions with no own properties of their own (kept as they are).
// Anything else (other prototypes, frozen, sealed or non-extensible objects, accessors, symbol,
// non-enumerable or `__proto__` keys, cycles or data deeper than 16) returns `NOT_PLAIN_DATA`. The
// top-level `identityKey` value is kept as it is (a layer's target).
export function copyPlainData(value: unknown, identityKey?: string, depth = 0): unknown {
  if (typeof value === "function") {
    return Reflect.ownKeys(value).every((key) => PLAIN_FUNCTION_KEYS.has(key)) ? value : NOT_PLAIN_DATA
  }
  if (typeof value !== "object" || value === null) return value

  const isArray = Array.isArray(value)
  const plain = isArray ? Object.getPrototypeOf(value) === Array.prototype : isPlainObject(value)
  if (!plain || !Object.isExtensible(value) || depth >= DEPTH_MAX) return NOT_PLAIN_DATA

  const copy = (isArray ? [] : {}) as Record<string, unknown>
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== "string" || key === "__proto__" || !("value" in descriptor)) return NOT_PLAIN_DATA
    if (!descriptor.enumerable && !(isArray && key === "length")) return NOT_PLAIN_DATA
    const read = Reflect.get(value, key)
    const entry = depth === 0 && key === identityKey ? read : copyPlainData(read, undefined, depth + 1)
    if (entry === NOT_PLAIN_DATA) return NOT_PLAIN_DATA
    copy[key] = entry
  }

  return copy
}

// Compares compiled layer data: arrays and plain objects (frozen ones too) by content, any two functions as
// equal, and everything else by identity. Data deeper than 32 compares unequal.
export function sameCompiledData(left: unknown, right: unknown, depth = 0): boolean {
  if (Object.is(left, right)) return true
  if (typeof left === "function") return typeof right === "function"
  if (!isContainer(left) || !isContainer(right) || Array.isArray(left) !== Array.isArray(right)) return false
  if (depth >= COMPILED_DEPTH_MAX) return false

  const keys = Reflect.ownKeys(left)
  return (
    keys.length === Reflect.ownKeys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameCompiledData(left[key], right[key], depth + 1))
  )
}

function isContainer(value: unknown): value is Record<PropertyKey, unknown> {
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
