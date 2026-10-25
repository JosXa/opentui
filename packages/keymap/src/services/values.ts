function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Bounds the walk; deeper or cyclic data compares unequal, which only costs a full replace.
const SAME_DEPTH_MAX = 16

// Compares arrays and plain objects by content, any two functions as equal, and everything else by identity.
export function sameIgnoringFunctions(left: unknown, right: unknown, depth = 0): boolean {
  if (Object.is(left, right)) return true
  if (typeof left === "function") return typeof right === "function"
  if (depth >= SAME_DEPTH_MAX || !isComparable(left) || !isComparable(right)) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false

  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameIgnoringFunctions(left[key], right[key], depth + 1))
  )
}

function isComparable(value: unknown): value is Record<string, unknown> {
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
