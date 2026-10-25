function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// A plain object whose own keys are all strings with enumerable data properties: safe to copy by value.
export function isPlainDataObject(value: object): boolean {
  return (
    isPlainObject(value) &&
    Reflect.ownKeys(value).every((key) => {
      const descriptor = typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : undefined
      return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor
    })
  )
}

// Bounds the copy; deeper or cyclic data gets a unique marker, so it compares unequal and costs a replace.
const SHAPE_DEPTH_MAX = 16
const FUNCTION_SHAPE = Symbol("function")

// Copies arrays and plain objects (symbol keys included) and replaces every function with one marker, so
// a later `sameShape` sees in-place mutations and treats any two functions as equal.
export function snapshotShape(value: unknown, depth = 0): unknown {
  if (typeof value === "function") return FUNCTION_SHAPE
  if (!isShapeContainer(value)) return value
  if (depth >= SHAPE_DEPTH_MAX) return Symbol("too deep")
  if (Array.isArray(value)) return value.map((entry) => snapshotShape(entry, depth + 1))
  return Object.fromEntries(Reflect.ownKeys(value).map((key) => [key, snapshotShape(value[key], depth + 1)]))
}

// Compares two `snapshotShape` results: containers by content, everything else by identity.
export function sameShape(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!isShapeContainer(left) || !isShapeContainer(right)) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false

  const keys = Reflect.ownKeys(left)
  return (
    keys.length === Reflect.ownKeys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameShape(left[key], right[key]))
  )
}

function isShapeContainer(value: unknown): value is Record<PropertyKey, unknown> {
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
