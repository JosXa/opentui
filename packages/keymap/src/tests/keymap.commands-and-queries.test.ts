import { Buffer } from "node:buffer"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BoxRenderable, KeyEvent, type Renderable } from "@opentui/core"
import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import * as addons from "../addons/index.js"
import { formatCommandBindings } from "../extras/index.js"
import {
  KEYMAP_EXTENSION_CONTEXT,
  stringifyKeySequence,
  stringifyKeyStroke,
  type ActiveKey,
  type ActiveKeyOptions,
  type BindingParser,
  type Command,
  type ErrorEvent,
  type EventMatchResolverContext,
  type Keymap,
  type ReactiveMatcher,
  type WarningEvent,
} from "../index.js"
import { createDefaultOpenTuiKeymap, createOpenTuiKeymap } from "../opentui.js"
import { createTestKeymap } from "../testing/index.js"
import { createDiagnosticHarness } from "./diagnostic-harness.js"
import { createKeymapTestHelpers, type OpenTuiKeymap } from "./keymap.test-support.js"

let renderer: TestRenderer
let mockInput: MockInput
const diagnostics = createDiagnosticHarness()
const {
  createFocusableBox,
  getActiveKey,
  getActiveKeyNames,
  getParserKeymap,
  getKeymap,
  createBareKeymap,
  getCommand,
  getCommandEntry,
  getActiveKeyDisplay,
  captureDiagnostics,
  matchEventAs,
  createBracketTokenParser,
  createReactiveBoolean,
} = createKeymapTestHelpers(diagnostics, () => renderer)

describe("keymap: commands and queries", () => {
  beforeEach(async () => {
    const testSetup = await createTestRenderer({ width: 40, height: 10 })
    renderer = testSetup.renderer
    mockInput = testSetup.mockInput
  })

  afterEach(() => {
    renderer?.destroy()
    diagnostics.assertNoUnhandledDiagnostics()
  })
  test("supports command metadata attributes in active keys and command contexts", () => {
    const keymap = getKeymap(renderer)
    const seen: Record<string, unknown>[] = []

    keymap.registerLayer({
      commands: [
        {
          name: "save-file",
          desc: "Save the current file",
          title: "Save File",
          category: "File",
          run(ctx) {
            seen.push({
              desc: ctx.command?.desc,
              title: ctx.command?.title,
              category: ctx.command?.category,
            })
          },
        },
      ],
    })

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "save-file" }],
    })

    const attrs = {
      desc: "Save the current file",
      title: "Save File",
      category: "File",
    }

    const activeKey = getActiveKey(keymap, "x", { includeBindings: true, includeMetadata: true })
    expect(activeKey?.bindings?.[0]?.command).toBe("save-file")
    expect(activeKey?.bindings?.[0]?.commandAttrs).toEqual(attrs)
    expect(activeKey?.command).toBe("save-file")
    expect(activeKey?.commandAttrs).toEqual(attrs)

    mockInput.pressKey("x")

    expect(seen).toEqual([attrs])
  })

  test("getCommands searches names by default and returns raw fields plus compiled attrs", () => {
    const keymap = getParserKeymap()

    keymap.registerCommandFields({
      title(value, ctx) {
        ctx.attr("label", value)
      },
    })

    keymap.registerLayer({
      commands: [
        {
          name: "save-current",
          namespace: "excommands",
          title: "Write File",
          usage: ":write <file>",
          tags: ["file", "write"],
          run() {},
        },
        {
          name: "session-reset",
          namespace: "excommands",
          title: "Reset Counters",
          run() {},
        },
        {
          name: "palette-help",
          namespace: "palette",
          title: "Open Help",
          run() {},
        },
      ],
    })

    expect(keymap.getCommands({ search: "save" }).map((command) => command.name)).toEqual(["save-current"])
    expect(keymap.getCommands({ search: "write" })).toEqual([])
    expect(keymap.getCommands({ search: "write", searchIn: ["title"] }).map((command) => command.name)).toEqual([
      "save-current",
    ])
    expect(keymap.getCommands({ search: "write", searchIn: ["label"] }).map((command) => command.name)).toEqual([
      "save-current",
    ])
    expect(getCommand(keymap, "save-current")).toMatchObject({
      name: "save-current",
      namespace: "excommands",
      title: "Write File",
      usage: ":write <file>",
      tags: ["file", "write"],
    })
  })

  test("getCommands supports namespace and filter queries across raw fields and attrs", () => {
    const keymap = getParserKeymap()

    keymap.registerCommandFields({
      title(value, ctx) {
        ctx.attr("label", value)
      },
    })

    const offCommands = keymap.registerLayer({
      commands: [
        {
          name: "save-current",
          namespace: "excommands",
          title: "Write File",
          usage: ":write <file>",
          tags: ["file", "write"],
          run() {},
        },
        {
          name: "session-reset",
          namespace: "excommands",
          title: "Reset Counters",
          tags: ["session"],
          run() {},
        },
        {
          name: "palette-help",
          namespace: "palette",
          title: "Open Help",
          tags: ["help"],
          run() {},
        },
        {
          name: "untagged-help",
          title: "excommands helper",
          tags: ["help"],
          run() {},
        },
      ],
    })

    expect(keymap.getCommands({ namespace: "excommands" }).map((command) => command.name)).toEqual([
      "save-current",
      "session-reset",
    ])
    expect(keymap.getCommands({ namespace: ["palette", "missing"] }).map((command) => command.name)).toEqual([
      "palette-help",
    ])
    expect(
      keymap
        .getCommands({ namespace: "excommands", search: "reset", searchIn: ["title"] })
        .map((command) => command.name),
    ).toEqual(["session-reset"])
    expect(keymap.getCommands({ filter: { namespace: "excommands" } }).map((command) => command.name)).toEqual([
      "save-current",
      "session-reset",
    ])
    expect(keymap.getCommands({ filter: { tags: "file" } }).map((command) => command.name)).toEqual(["save-current"])
    expect(keymap.getCommands({ filter: { label: "Reset Counters" } }).map((command) => command.name)).toEqual([
      "session-reset",
    ])
    expect(
      keymap
        .getCommands({
          filter: {
            usage(value: unknown, command: Command) {
              return typeof value === "string" && value.includes("<file>") && command.namespace === "excommands"
            },
          },
        })
        .map((command) => command.name),
    ).toEqual(["save-current"])
    expect(
      keymap
        .getCommands({
          namespace: "excommands",
          filter: {
            usage(value: unknown) {
              return typeof value === "string" && value.includes("<file>")
            },
          },
        })
        .map((command) => command.name),
    ).toEqual(["save-current"])
    expect(
      keymap.getCommands({ filter: (command) => command.name === "palette-help" }).map((command) => command.name),
    ).toEqual(["palette-help"])
    expect(
      keymap.getCommands({ filter: { name: ["palette-help", "missing"] } }).map((command) => command.name),
    ).toEqual(["palette-help"])
    expect(
      keymap
        .getCommands({ filter: { name: ["save-current", "palette-help"], namespace: "excommands" } })
        .map((command) => command.name),
    ).toEqual(["save-current"])
    expect(keymap.getCommands({ filter: { name: [] } }).map((command) => command.name)).toEqual([])

    offCommands()

    expect(keymap.getCommands()).toEqual([])
  })

  test("getCommands defaults to reachable commands and supports active and registered visibility", () => {
    const keymap = getKeymap(renderer)

    const target = createFocusableBox("command-visibility-target")
    renderer.root.add(target)

    keymap.registerLayer({
      commands: [
        { name: "save", title: "Global Save", run() {} },
        { name: "quit", title: "Quit", run() {} },
      ],
    })
    keymap.registerLayer({
      target,
      commands: [{ name: "save", title: "Local Save", run() {} }],
    })

    expect(keymap.getCommands().map((command) => command.name)).toEqual(["save", "quit"])
    expect(keymap.getCommands().map((command) => command.title)).toEqual(["Global Save", "Quit"])
    expect(keymap.getCommands({ visibility: "active" }).map((command) => command.title)).toEqual([
      "Global Save",
      "Quit",
    ])
    expect(keymap.getCommands({ visibility: "registered" }).map((command) => command.title)).toEqual([
      "Global Save",
      "Quit",
      "Local Save",
    ])

    target.focus()

    expect(keymap.getCommands().map((command) => command.title)).toEqual(["Local Save", "Quit"])
    expect(keymap.getCommands({ visibility: "active" }).map((command) => command.title)).toEqual([
      "Local Save",
      "Global Save",
      "Quit",
    ])
    expect(keymap.getCommands({ visibility: "registered" }).map((command) => command.title)).toEqual([
      "Global Save",
      "Quit",
      "Local Save",
    ])
  })

  test("getCommandEntries returns commands with bindings across visibility modes", () => {
    const keymap = getKeymap(renderer)
    const target = createFocusableBox("command-entry-visibility-target")
    renderer.root.add(target)

    keymap.registerLayer({
      commands: [
        { name: "save", title: "Global Save", run() {} },
        { name: "quit", title: "Quit", run() {} },
      ],
      bindings: [
        { key: "x", cmd: "save", desc: "Write current file" },
        { key: "q", cmd: "quit", desc: "Quit app" },
      ],
    })
    keymap.registerLayer({
      target,
      commands: [{ name: "save", title: "Local Save", run() {} }],
      bindings: [{ key: "l", cmd: "save", desc: "Save in panel" }],
    })

    const snapshot = (visibility?: "reachable" | "active" | "registered") => {
      return keymap.getCommandEntries(visibility ? { visibility } : undefined).map((entry) => ({
        title: entry.command.title,
        bindings: entry.bindings
          .map((binding) => stringifyKeySequence(binding.sequence, { preferDisplay: true }))
          .sort(),
      }))
    }

    expect(snapshot()).toEqual([
      { title: "Global Save", bindings: ["x"] },
      { title: "Quit", bindings: ["q"] },
    ])

    target.focus()

    expect(snapshot()).toEqual([
      { title: "Local Save", bindings: ["l", "x"] },
      { title: "Quit", bindings: ["q"] },
    ])
    expect(snapshot("active")).toEqual([
      { title: "Local Save", bindings: ["l", "x"] },
      { title: "Global Save", bindings: ["l", "x"] },
      { title: "Quit", bindings: ["q"] },
    ])
    expect(snapshot("registered")).toEqual([
      { title: "Global Save", bindings: ["l", "x"] },
      { title: "Quit", bindings: ["q"] },
      { title: "Local Save", bindings: ["l", "x"] },
    ])
  })

  test("getCommandBindings returns requested command binding groups", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      commands: [
        { name: "save", title: "Save", run() {} },
        { name: "quit", title: "Quit", run() {} },
      ],
      bindings: [
        { key: "ctrl+s", cmd: "save", desc: "Save with control" },
        { key: "s", cmd: "save" },
        { key: "q", cmd: "quit" },
        { key: "x", cmd: "unrequested" },
      ],
    })

    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["quit", "missing", "save"],
    })

    expect([...bindings.keys()]).toEqual(["quit", "missing", "save"])
    expect(bindings.get("quit")?.map((binding) => stringifyKeySequence(binding.sequence))).toEqual(["q"])
    expect(bindings.get("missing")).toEqual([])
    expect(bindings.get("save")?.map((binding) => stringifyKeySequence(binding.sequence))).toEqual(["ctrl+s", "s"])
    expect(bindings.get("save")?.[0]).toMatchObject({
      command: "save",
      commandAttrs: {
        title: "Save",
      },
      attrs: {
        desc: "Save with control",
      },
      event: "press",
      preventDefault: true,
      fallthrough: false,
    })
  })

  test("getCommandBindings collapses duplicate command records without duplicating bindings", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      commands: [{ name: "duplicate", title: "First", run() {} }],
      bindings: [{ key: "a", cmd: "duplicate" }],
    })
    keymap.registerLayer({
      commands: [{ name: "duplicate", title: "Second", run() {} }],
      bindings: [{ key: "b", cmd: "duplicate" }],
    })

    expect(
      keymap
        .getCommandEntries({ visibility: "registered", filter: { name: "duplicate" } })
        .map((entry) => entry.bindings.map((binding) => stringifyKeySequence(binding.sequence))),
    ).toEqual([
      ["a", "b"],
      ["a", "b"],
    ])
    expect(
      keymap
        .getCommandBindings({ visibility: "registered", commands: ["duplicate"] })
        .get("duplicate")
        ?.map((binding) => stringifyKeySequence(binding.sequence)),
    ).toEqual(["a", "b"])
  })

  test("getCommandBindings respects registered and active visibility", () => {
    const keymap = getKeymap(renderer)
    const target = createFocusableBox("command-binding-visibility-target")
    renderer.root.add(target)

    keymap.registerLayer({
      commands: [{ name: "save", title: "Global Save", run() {} }],
      bindings: [{ key: "x", cmd: "save" }],
    })
    keymap.registerLayer({
      target,
      commands: [{ name: "save", title: "Local Save", run() {} }],
      bindings: [{ key: "l", cmd: "save" }],
    })

    const labels = (visibility?: "reachable" | "active" | "registered") => {
      return keymap
        .getCommandBindings({ visibility, commands: ["save"] })
        .get("save")
        ?.map((binding) => stringifyKeySequence(binding.sequence))
    }

    expect(labels()).toEqual(["x"])
    expect(labels("active")).toEqual(["x"])
    expect(labels("registered")).toEqual(["x", "l"])

    target.focus()

    expect(labels()).toEqual(["l", "x"])
    expect(labels("active")).toEqual(["l", "x"])
    expect(labels("registered")).toEqual(["x", "l"])
  })

  test("getCommandBindings filters inactive bindings outside registered visibility", () => {
    const keymap = getKeymap(renderer)
    let enabled = false

    keymap.registerBindingFields({
      active(value, ctx) {
        if (value !== true) {
          throw new Error('Keymap binding field "active" must be true')
        }

        ctx.activeWhen(() => enabled)
      },
    })
    keymap.registerLayer({
      commands: [{ name: "conditional", run() {} }],
      bindings: [{ key: "x", cmd: "conditional", active: true }],
    })

    const labels = (visibility?: "reachable" | "active" | "registered") => {
      return keymap
        .getCommandBindings({ visibility, commands: ["conditional"] })
        .get("conditional")
        ?.map((binding) => stringifyKeySequence(binding.sequence))
    }

    expect(labels()).toEqual([])
    expect(labels("active")).toEqual([])
    expect(labels("registered")).toEqual(["x"])

    enabled = true

    expect(labels()).toEqual(["x"])
    expect(labels("active")).toEqual(["x"])
  })

  test("getCommandBindings includes registered bindings and applies resolver visibility", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "external-run" }],
    })

    const labels = (visibility?: "reachable" | "active" | "registered") => {
      return keymap
        .getCommandBindings({ visibility, commands: ["external-run"] })
        .get("external-run")
        ?.map((binding) => stringifyKeySequence(binding.sequence))
    }

    expect(labels("registered")).toEqual(["x"])
    expect(labels()).toEqual([])

    keymap.appendCommandResolver((command) => {
      if (command !== "external-run") {
        return undefined
      }

      return {
        name: command,
        title: "External Run",
        run() {},
      }
    })

    const activeBindings = keymap.getCommandBindings({ commands: ["external-run"] }).get("external-run")

    expect(activeBindings?.map((binding) => stringifyKeySequence(binding.sequence))).toEqual(["x"])
    expect(activeBindings?.[0]?.commandAttrs).toEqual({ title: "External Run" })
  })

  test("getCommandEntries reuses active binding views and keeps command-only entries", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      commands: [
        {
          name: "save-file",
          desc: "Save the current file",
          title: "Save File",
          category: "File",
          run() {},
        },
        {
          name: "palette-help",
          title: "Open Help",
          run() {},
        },
      ],
      bindings: [{ key: "x", cmd: "save-file", desc: "Write current file", group: "File" }],
    })

    const save = getCommandEntry(keymap, "save-file")
    expect(save).toMatchObject({
      command: {
        name: "save-file",
        desc: "Save the current file",
        title: "Save File",
        category: "File",
      },
      bindings: [
        {
          sequence: save?.bindings[0]?.sequence,
          command: "save-file",
          commandAttrs: {
            desc: "Save the current file",
            title: "Save File",
            category: "File",
          },
          attrs: {
            desc: "Write current file",
            group: "File",
          },
          event: "press",
          preventDefault: true,
          fallthrough: false,
        },
      ],
    })

    expect(getCommandEntry(keymap, "palette-help")).toMatchObject({
      command: {
        name: "palette-help",
        title: "Open Help",
      },
      bindings: [],
    })
  })

  test("getCommandEntries applies command query filters before attaching bindings", () => {
    const keymap = getParserKeymap()

    keymap.registerCommandFields({
      title(value, ctx) {
        ctx.attr("label", value)
      },
    })

    keymap.registerLayer({
      commands: [
        {
          name: "save-current",
          namespace: "excommands",
          title: "Write File",
          usage: ":write <file>",
          run() {},
        },
        {
          name: "palette-help",
          namespace: "palette",
          title: "Open Help",
          usage: ":help",
          run() {},
        },
      ],
      bindings: [
        { key: "x", cmd: "save-current" },
        { key: "h", cmd: "palette-help" },
      ],
    })

    expect(
      keymap
        .getCommandEntries({ namespace: "excommands", search: "write", searchIn: ["title", "label"] })
        .map((entry) => ({
          name: entry.command.name,
          bindings: entry.bindings.map((binding) => stringifyKeySequence(binding.sequence, { preferDisplay: true })),
        })),
    ).toEqual([
      {
        name: "save-current",
        bindings: ["x"],
      },
    ])
  })

  test("getCommandEntries supports result limits", () => {
    const keymap = getParserKeymap()

    keymap.registerLayer({
      commands: [
        { name: "alpha", run() {} },
        { name: "beta", run() {} },
        { name: "gamma", run() {} },
      ],
      bindings: [
        { key: "a", cmd: "alpha" },
        { key: "b", cmd: "beta" },
        { key: "g", cmd: "gamma" },
      ],
    })

    expect(keymap.getCommandEntries({ visibility: "registered", limit: 2 }).map((entry) => entry.command.name)).toEqual(
      ["alpha", "beta"],
    )
    expect(keymap.getCommandEntries({ visibility: "registered", limit: 0 })).toEqual([])
  })

  test("getCommands treats thrown filter predicates as errors and returns no matches", () => {
    const keymap = getKeymap(renderer)
    const { takeErrors } = captureDiagnostics(keymap)

    keymap.registerLayer({
      commands: [
        { name: "save-current", usage: ":write <file>", run() {} },
        { name: "palette-help", usage: ":help", run() {} },
      ],
    })

    let queryResult: ReturnType<OpenTuiKeymap["getCommands"]> = []

    expect(() => {
      queryResult = keymap.getCommands({
        filter(command) {
          throw new Error(`query ${command.name}`)
        },
      })
    }).not.toThrow()

    expect(queryResult).toEqual([])
    expect(takeErrors().errors).toEqual([
      "[Keymap] Error in command query filter:",
      "[Keymap] Error in command query filter:",
    ])

    expect(() => {
      queryResult = keymap.getCommands({
        filter: {
          usage() {
            throw new Error("usage boom")
          },
        },
      })
    }).not.toThrow()

    expect(queryResult).toEqual([])
    expect(takeErrors().errors).toEqual([
      "[Keymap] Error in command query filter:",
      "[Keymap] Error in command query filter:",
    ])
  })

  test("failed command registration does not reserve the command name", () => {
    const keymap = getKeymap(renderer)
    const { takeErrors } = captureDiagnostics(keymap)
    const calls: string[] = []

    keymap.registerCommandFields({
      broken() {
        throw new Error("broken command field")
      },
    })

    keymap.registerLayer({
      commands: [
        {
          name: "retry-command",
          broken: true,
          run() {
            calls.push("broken")
          },
        },
        {
          name: "retry-command",
          run() {
            calls.push("registered")
          },
        },
      ],
    })

    expect(keymap.getCommands().map((command) => command.name)).toEqual(["retry-command"])
    expect(keymap.runCommand("retry-command")).toEqual({ ok: true })
    expect(calls).toEqual(["registered"])
    expect(takeErrors().errors).toEqual(["broken command field"])
  })

  test("replacing a layer costs state events, entries, and labels only when its content changes", () => {
    const layerOf = (layer: number, commands: number, change?: string) => ({
      commands: Array.from({ length: commands + (change === "command added" ? 1 : 0) }, (_, c) => ({
        name: `l${layer}.c${c}`,
        tags: change === "array to object" ? {} : [],
        run() {},
      })),
      bindings: [
        ...Array.from({ length: commands }, (_, c) => ({
          key: c === 0 && change === "changed binding" ? "ctrl+shift+a" : `ctrl+${"abcdefghij"[c]}`,
          cmd: `l${layer}.c${c}`,
          ...(c === 0 && change === "binding field added" ? { desc: "d" } : {}),
        })),
        ...(change === "binding added" ? [{ key: "ctrl+z", cmd: `l${layer}.c0` }] : []),
      ],
    })
    // Layer 0, the oldest, is replaced and keeps its position. `work` is state events, entries built, and
    // labels formatted by a `state` listener.
    const rows = [
      { change: "identical", layers: 3, commands: 4, work: [0, 0, 0] },
      { change: "identical", layers: 6, commands: 4, work: [0, 0, 0] },
      { change: "fresh functions", layers: 3, commands: 4, work: [0, 0, 0] },
      { change: "fresh functions", layers: 3, commands: 8, work: [0, 0, 0] },
      { change: "changed binding", layers: 3, commands: 4, work: [1, 12, 12] },
      { change: "changed binding", layers: 6, commands: 4, work: [1, 24, 24] },
      { change: "binding added", layers: 3, commands: 4, work: [1, 12, 13] },
      { change: "command added", layers: 3, commands: 4, work: [1, 13, 12] },
      { change: "binding field added", layers: 3, commands: 4, work: [1, 12, 12] },
      { change: "array to object", layers: 3, commands: 4, work: [1, 12, 12] },
      { change: "removed", layers: 3, commands: 4, work: [1, 8, 8] },
      { change: "removed", layers: 3, commands: 8, work: [1, 16, 16] },
    ] as const

    for (const row of rows) {
      const keymap = getKeymap(renderer)
      const { layers } = keymap[KEYMAP_EXTENSION_CONTEXT]()
      const first = layerOf(0, row.commands)
      const replaced = layers.replaceLayer(undefined, first)
      for (let layer = 1; layer < row.layers; layer += 1) layers.replaceLayer(undefined, layerOf(layer, row.commands))

      const work = [0, 0, 0]
      const countLabels = new Proxy({}, { get: () => void (work[2]! += 1) })
      keymap.on("state", () => {
        work[0]! += 1
        for (const entry of keymap.getCommandEntries()) {
          work[1]! += 1
          formatCommandBindings(entry.bindings, { keyNameAliases: countLabels })
        }
      })

      const next = { identical: first, removed: undefined }[row.change as string]
      layers.replaceLayer(
        replaced,
        row.change in { identical: 1, removed: 1 } ? next : layerOf(0, row.commands, row.change),
      )

      expect({ change: row.change, work }).toEqual({ change: row.change, work: [...row.work] })
      const kept = Array.from({ length: row.layers }, (_, layer) => layer).filter(
        (layer) => layer > 0 || row.change !== "removed",
      )
      const names = (order: number[]) => order.map((layer) => `l${layer}.c1`)
      const reachable = keymap.getCommands().map((command) => command.name)
      const registered = keymap.getCommands({ visibility: "registered" }).map((command) => command.name)
      expect(reachable.filter((name) => name.endsWith(".c1"))).toEqual(names(kept.toReversed()))
      expect(registered.filter((name) => name.endsWith(".c1"))).toEqual(names(kept))
      expect(getActiveKey(keymap, "b")?.command).toBe(`l${row.layers - 1}.c1`)
    }
  })

  test("a replace keeps a plain-data layer's objects and fully replaces anything else", () => {
    const calls: string[] = []
    const command = (label: string, extra: object = {}) => ({ name: "c", run: () => void calls.push(label), ...extra })
    const getter = (label: string) => ({
      name: "c",
      get title() {
        return "t"
      },
      run: () => void calls.push(label),
    })
    const hidden = (label: string) =>
      Object.defineProperty({ name: "c" }, "run", { value: () => void calls.push(label) })
    const tagged = (label: string) => Object.assign(() => void calls.push(label), { tag: label })
    const throwing = (target: object, when: () => boolean) =>
      new Proxy(target, {
        ownKeys: (target) => {
          if (when()) throw new Error("unreadable")
          return Reflect.ownKeys(target)
        },
      })
    const nested = (depth: number): object => (depth === 0 ? {} : { inner: nested(depth - 1) })
    const cyclic = () => {
      const meta: Record<string, unknown> = {}
      meta.self = meta
      return meta
    }
    let reads = 0
    // Reports static descriptors, but every read of `title` once armed returns a new value.
    const counting = (target: object) =>
      new Proxy(target, { get: (target, key) => (key === "title" && armed ? `t${reads++}` : Reflect.get(target, key)) })
    const symbol = Symbol("field")
    const meta = { label: "a" }
    const map = new Map()
    class Tags extends Array {}
    let armed = false
    let flag = true
    const enabled = () => flag
    // [state events, calls of `runCommand`, of a `run` read before the replace and of its `meta.call`, visible
    // commands]. A kept layer's retained objects call the new functions; a replaced layer's are the caller's.
    const outcomes = {
      kept: [0, ["new", "new"], 1],
      "kept, now disabled": [1, ["new", "new"], 0],
      "kept, enabled again": [1, ["new", "new"], 1],
      "kept, nested function": [0, ["new", "new", "meta new"], 1],
      replaced: [1, ["new", "old"], 1],
      "replaced, now disabled": [1, ["new", "old"], 0],
    }
    const rows: [string, object, object, keyof typeof outcomes][] = [
      ["fresh functions", command("old"), command("new"), "kept"],
      [
        "null-prototype data",
        command("old", { meta: Object.create(null) }),
        command("new", { meta: Object.create(null) }),
        "kept",
      ],
      [
        "nested function",
        command("old", { meta: { call: () => void calls.push("meta old") } }),
        command("new", { meta: { call: () => void calls.push("meta new") } }),
        "kept, nested function",
      ],
      ["proxy that ignores writes", new Proxy(command("old"), { set: () => true }), command("new"), "kept"],
      ["proxy that throws once registered", throwing(command("old"), () => armed), command("new"), "kept"],
      ["enabled same result", command("old", { enabled: () => true }), command("new", { enabled: () => true }), "kept"],
      [
        "enabled flips",
        command("old", { enabled: () => true }),
        command("new", { enabled: () => false }),
        "kept, now disabled",
      ],
      [
        "shared flag flips, fresh closure",
        command("old", { enabled: () => flag }),
        command("new", { enabled: () => flag }),
        "kept, now disabled",
      ],
      [
        "shared flag flips, same function",
        command("old", { enabled }),
        command("new", { enabled }),
        "kept, now disabled",
      ],
      [
        "shared flag flips back after an event",
        command("old", { enabled }),
        command("new", { enabled }),
        "kept, enabled again",
      ],
      // One row per rule that the plain-data check enforces.
      ["class instance", command("old", { meta: new Map() }), command("new", { meta: new Map() }), "replaced"],
      [
        "array subclass",
        command("old", { tags: Tags.from([1]) }),
        command("new", { tags: Tags.from([1]) }),
        "replaced",
      ],
      ["symbol key", command("old", { [symbol]: 1 }), command("new", { [symbol]: 1 }), "replaced"],
      [
        "symbol key on an array",
        command("old", { tags: Object.assign([1], { [symbol]: 1 }) }),
        command("new", { tags: Object.assign([1], { [symbol]: 1 }) }),
        "replaced",
      ],
      ["getter", getter("old"), getter("new"), "replaced"],
      ["plain after a getter", getter("old"), command("new", { title: "t" }), "replaced"],
      ["non-enumerable key", hidden("old"), hidden("new"), "replaced"],
      [
        "frozen object",
        command("old", { meta: Object.freeze({}) }),
        command("new", { meta: Object.freeze({}) }),
        "replaced",
      ],
      [
        "sealed object",
        command("old", { meta: Object.seal({}) }),
        command("new", { meta: Object.seal({}) }),
        "replaced",
      ],
      ["function with properties", { name: "c", run: tagged("old") }, { name: "c", run: tagged("new") }, "replaced"],
      ["deeper than 16", command("old", { meta: nested(16) }), command("new", { meta: nested(16) }), "replaced"],
      ["cycle", command("old", { meta: cyclic() }), command("new", { meta: cyclic() }), "replaced"],
      [
        "own __proto__ key",
        command("old", JSON.parse('{"__proto__":1}')),
        command("new", JSON.parse('{"__proto__":1}')),
        "replaced",
      ],
      [
        "proxy whose reads change",
        counting(command("old", { title: "t" })),
        counting(command("new", { title: "t" })),
        "replaced",
      ],
      [
        "reading it throws",
        command("old", { meta: throwing({}, () => true) }),
        command("new", { meta: throwing({}, () => true) }),
        "replaced",
      ],
      // Plain data that changed, also in place, and non-plain data mutated in place.
      ["nested data mutated", command("old", { meta }), command("new", { meta }), "replaced"],
      ["map mutated in place", command("old", { meta: map }), command("new", { meta: map }), "replaced"],
      ["function to string", command("old", { label: () => "d" }), command("new", { label: "d" }), "replaced"],
      [
        "enabled to boolean",
        command("old", { enabled: () => true }),
        command("new", { enabled: false }),
        "replaced, now disabled",
      ],
    ]

    for (const [change, first, next, outcome] of rows) {
      const keymap = getKeymap(renderer)
      const { layers } = keymap[KEYMAP_EXTENSION_CONTEXT]()
      armed = false
      flag = true
      const copies = [{ ...first }, { ...next }]
      const registered = layers.replaceLayer(undefined, { commands: [first as never] })
      const retained = keymap.getCommands({ visibility: "registered" })[0]!
      let events = 0
      keymap.on("state", () => void (events += 1))
      armed = true
      if (change === "nested data mutated") meta.label = "b"
      if (change === "map mutated in place") map.set("key", 1)
      if (change.startsWith("shared flag")) flag = false
      if (change === "shared flag flips back after an event") {
        keymap.setData("unrelated", 1)
        flag = true
      }

      events = 0
      layers.replaceLayer(registered, { commands: [next as never] })
      calls.length = 0
      keymap.runCommand("c")
      retained.run({} as never)
      ;(retained.meta as { call?: () => void } | undefined)?.call?.()
      expect([change, events, calls, keymap.getCommands().length]).toEqual([change, ...outcomes[outcome]])
      // A command that is not plain data is handed out as it is, with its symbol keys and function properties.
      if (change === "symbol key") expect((retained as Record<symbol, unknown>)[symbol]).toBe(1)
      if (change === "function with properties") expect((retained.run as { tag?: unknown }).tag).toBeDefined()
      armed = false
      expect([{ ...first }, { ...next }]).toEqual(copies)
    }
  })

  test("an identical replace keeps the layer's order and the latest inline handlers, also after a recompile", () => {
    const keymap = getKeymap(renderer)
    const { layers } = keymap[KEYMAP_EXTENSION_CONTEXT]()
    const calls: string[] = []
    const orders: number[][] = []
    keymap.on("dispatch", (event) => {
      if (event.layer && event.binding) orders.push([event.layer.order, event.binding.sourceLayerOrder])
    })
    const layerOf = (version: string) => ({ bindings: [{ key: "y", cmd: () => void calls.push(version) }] })

    const registered = layers.replaceLayer(undefined, layerOf("old"))
    layers.replaceLayer(undefined, { bindings: [{ key: "z", cmd: () => {} }] })
    getActiveKey(keymap, "y")
    expect(layers.replaceLayer(registered, layerOf("new"))).toBe(registered)

    mockInput.pressKey("y")
    ;(getActiveKey(keymap, "y")!.command as () => void)()
    keymap.appendDisambiguationResolver(() => undefined)
    mockInput.pressKey("y")
    expect(calls).toEqual(["new", "new", "new"])
    expect(orders).toEqual([
      [0, 0],
      [0, 0],
    ])
  })

  test("the plain-data check covers the layer object itself", () => {
    const commands = (...names: string[]) => names.map((name) => ({ name, run() {} }))
    const shared = { name: "c", meta: { label: "a" }, run() {} }
    const hidden = (key: string, value: unknown, layer: object = { commands: commands("c") }) =>
      Object.defineProperty(layer, key, { value })
    const rows: [string, () => object, () => object, string[]][] = [
      [
        "getter",
        () => ({
          get priority() {
            return 0
          },
          commands: commands("c"),
        }),
        () => ({
          get priority() {
            return 0
          },
          commands: commands("c"),
        }),
        ["c"],
      ],
      [
        "frozen layer",
        () => Object.freeze({ commands: commands("c") }),
        () => Object.freeze({ commands: commands("c") }),
        ["c"],
      ],
      ["non-enumerable priority", () => hidden("priority", 0), () => hidden("priority", 10), ["c"]],
      // Kept only if the registered layer was compiled from a copy: this one holds the caller's `meta`.
      [
        "frozen layer, then its data changed in place",
        () => Object.freeze({ commands: [shared] }),
        () => {
          shared.meta.label = "b"
          return { commands: [shared] }
        },
        ["c"],
      ],
      [
        "non-enumerable commands",
        () => hidden("commands", commands("c"), {}),
        () => hidden("commands", commands("c", "d"), {}),
        ["c", "d"],
      ],
    ]

    for (const [change, first, next, names] of rows) {
      const keymap = getKeymap(renderer)
      const { layers } = keymap[KEYMAP_EXTENSION_CONTEXT]()
      const registered = layers.replaceLayer(undefined, first() as never)
      let events = 0
      keymap.on("state", () => void (events += 1))

      const layer = next() as { commands: object[] }
      layers.replaceLayer(registered, layer as never)
      const registeredCommands = keymap.getCommands({ visibility: "registered" })
      const plainNext = change.startsWith("frozen layer, then")
      const sameObjects = plainNext || registeredCommands.every((command, index) => command === layer.commands[index])
      expect([change, events, registeredCommands.map(({ name }) => name), sameObjects]).toEqual([
        change,
        1,
        names,
        true,
      ])
    }
  })

  test("a replace compares the target by identity and the compiled layer by content", () => {
    const keymap = getKeymap(renderer)
    const plain = createTestKeymap()
    const first = createFocusableBox("first")
    const layerOf = (target: object, key = "x") => ({
      target,
      commands: [{ name: "c", run() {} }],
      bindings: [{ key, cmd: "c" }],
    })
    const counts: Record<string, number> = {}
    const replaceIn = (target: typeof keymap | typeof plain.keymap, step: string, steps: [string, () => object][]) => {
      const { layers } = target[KEYMAP_EXTENSION_CONTEXT]()
      let registered: unknown
      let events = 0
      target.on("state", () => void (events += 1))
      for (const [name, layer] of steps) {
        events = 0
        registered = layers.replaceLayer(registered as never, layer() as never)
        if (name) counts[`${step} ${name}`] = events
      }
    }
    let titles = 0
    let keys = 0

    replaceIn(keymap, "renderable", [
      ["", () => layerOf(first)],
      ["same", () => layerOf(first)],
      ["other", () => layerOf(createFocusableBox("second"))],
    ])
    replaceIn(plain.keymap, "plain target", [
      ["", () => layerOf({ id: "t" })],
      ["deeply equal", () => layerOf({ id: "t" })],
    ])
    const impure = getKeymap(renderer)
    impure.appendCommandTransformer((command) => void (command.title = `title ${titles++}`))
    impure.appendLayerBindingsTransformer((bindings) =>
      bindings.map((binding) => ({ ...binding, key: keys++ === 0 ? "x" : "y" })),
    )
    const cyclic = getKeymap(renderer)
    cyclic.appendCommandTransformer((command) => {
      const meta: Record<string, unknown> = {}
      command.meta = Object.assign(meta, { self: meta })
    })
    replaceIn(cyclic, "cyclic transformer output", [
      ["", () => layerOf(first)],
      ["again", () => layerOf(first)],
    ])
    replaceIn(impure, "impure transformers", [
      ["", () => layerOf(first, "q")],
      ["first", () => layerOf(first, "q")],
      ["second", () => layerOf(first, "q")],
    ])
    plain.cleanup()

    expect(counts).toEqual({
      "renderable same": 0,
      "renderable other": 1,
      "plain target deeply equal": 1,
      "cyclic transformer output again": 1,
      "impure transformers first": 1,
      "impure transformers second": 1,
    })
    const registered = impure.getCommandEntries({ visibility: "registered" })
    const used = registered.map(({ command, bindings }) => [command.title, stringifyKeySequence(bindings[0]!.sequence)])
    expect(used).toEqual([["title 2", "y"]])
  })

  test("compile hooks that make the compiled layer not plain data cause a full replace", () => {
    const calls: string[] = []
    let compiles = 0
    let getterRuns = 0
    const attr = (value: (compile: number) => unknown) => (keymap: OpenTuiKeymap) =>
      keymap.registerCommandFields({ meta: (_value, ctx) => ctx.attr("meta", value(compiles++)) })
    const map = new Map<string, number>()
    const throwing = new Proxy(
      { label: "" },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("unreadable")
        },
      },
    )
    // Each hook runs on both compiles. Commands that are not plain data are handed out as they are; other
    // compiled values that are not plain data compare unequal, without running getters.
    const hooks: [string, (keymap: OpenTuiKeymap) => void][] = [
      [
        "prototype run",
        (keymap) =>
          keymap.appendCommandTransformer((command) => {
            const { run } = command
            delete (command as { run?: unknown }).run
            Object.setPrototypeOf(command, { run })
          }),
      ],
      [
        "non-enumerable run",
        (keymap) =>
          keymap.appendCommandTransformer((command) => {
            Object.defineProperty(command, "run", { value: command.run, enumerable: false })
          }),
      ],
      [
        "command field whose descriptors throw",
        (keymap) => keymap.appendCommandTransformer((command) => void (command.meta = throwing)),
      ],
      ["map attr changed in place", attr((compile) => map.set("compiles", compile))],
      ["function attr with properties", attr(() => Object.assign(() => {}, { tag: 1 }))],
      [
        "getter attr in both layers",
        attr(() => ({
          get label() {
            return String(getterRuns++)
          },
        })),
      ],
      // Compared through its descriptors, which are equal, so the layer is kept without running the trap.
      ["attr proxy whose reads run code", attr(() => new Proxy({ label: "0" }, { get: () => String(getterRuns++) }))],
      [
        "getter attr in the kept layer",
        attr((compile) =>
          compile === 0
            ? {
                get label() {
                  return String(getterRuns++)
                },
              }
            : { label: "0" },
        ),
      ],
      ["attr whose descriptors throw", attr(() => throwing)],
    ]

    for (const [hook, install] of hooks) {
      const keymap = getKeymap(renderer)
      const { layers } = keymap[KEYMAP_EXTENSION_CONTEXT]()
      install(keymap)
      compiles = 0
      const layerOf = (label: string) => ({ commands: [{ name: "c", meta: 1, run: () => void calls.push(label) }] })
      const registered = layers.replaceLayer(undefined, layerOf("old"))
      let events = 0
      keymap.on("state", () => void (events += 1))

      layers.replaceLayer(registered, layerOf("new"))
      calls.length = 0
      keymap.runCommand("c")
      expect([hook, events, calls, getterRuns]).toEqual([hook, hook.startsWith("attr proxy") ? 0 : 1, ["new"], 0])
    }
  })

  test("a replace compiles from the one read it compares", () => {
    const keymap = getKeymap(renderer)
    const { layers } = keymap[KEYMAP_EXTENSION_CONTEXT]()
    let reads = 0
    let armed = false
    // Once armed, the first read of `title` and every third after it return "t"; the others a new value.
    const layerOf = () => ({
      commands: [
        new Proxy(
          { name: "c", title: "t", run() {} },
          {
            get: (target, key) =>
              key === "title" && armed ? (++reads % 3 === 1 ? "t" : `c${reads}`) : Reflect.get(target, key),
          },
        ),
      ],
    })
    let events = 0
    keymap.on("state", () => void (events += 1))

    let registered = layers.replaceLayer(undefined, layerOf())
    armed = true
    const seen: unknown[] = []
    for (let step = 0; step < 2; step += 1) {
      events = 0
      registered = layers.replaceLayer(registered, layerOf())
      seen.push([events, keymap.getCommands()[0]!.title])
    }
    expect(seen).toEqual([
      [0, "t"],
      [1, "c2"],
    ])
  })

  test("a failed reactive subscription is retried by the next replace", () => {
    const keymap = getKeymap(renderer)
    const { takeErrors } = captureDiagnostics(keymap)
    const { layers } = keymap[KEYMAP_EXTENSION_CONTEXT]()
    let attempts = 0
    const layerOf = () => ({
      enabled: {
        get: () => true,
        subscribe: () => {
          attempts += 1
          if (attempts === 1) throw new Error("not yet")
          return () => {}
        },
      },
      commands: [{ name: "c", run() {} }],
    })

    const registered = layers.replaceLayer(undefined, layerOf())
    layers.replaceLayer(registered, layerOf())
    expect(attempts).toBe(2)
    expect(takeErrors().errors).toEqual(["not yet"])
  })

  test("a command object shared by two layers keeps each layer's own handler", () => {
    const keymap = getKeymap(renderer)
    const { layers } = keymap[KEYMAP_EXTENSION_CONTEXT]()
    const calls: string[] = []
    const shared = { name: "c", run: () => void calls.push("shared") }

    const replaced = layers.replaceLayer(undefined, { commands: [shared] })
    layers.replaceLayer(undefined, { priority: -1, commands: [shared] })
    layers.replaceLayer(replaced, { commands: [{ name: "c", run: () => void calls.push("fresh") }] })
    keymap.runCommand("c")
    layers.replaceLayer(replaced, undefined)
    keymap.runCommand("c")
    expect(calls).toEqual(["fresh", "shared"])
  })

  test("registerLayer still rejects a frozen command, whose name it normalizes in place", () => {
    const keymap = getKeymap(renderer)
    const { takeErrors } = captureDiagnostics(keymap)

    keymap.registerLayer({ commands: [Object.freeze({ name: "c", run() {} })] })
    expect([keymap.getCommands().length, takeErrors().errors.length]).toEqual([0, 1])
  })

  test("getCommands returns the registered command object across repeated reads", () => {
    const keymap = getKeymap(renderer)
    const command = {
      name: "save-current",
      tags: ["file", "write"],
      run() {},
    }

    keymap.registerLayer({
      commands: [command],
    })

    const first = getCommand(keymap, "save-current")
    expect(first).toBe(command)

    const second = getCommand(keymap, "save-current")
    expect(second).toBe(first)
    expect(second?.tags).toEqual(["file", "write"])
  })

  test("getCommands returns command metadata by reference", () => {
    const keymap = getKeymap(renderer)
    const opaque = new Map([["recent", 1]])
    const helper = () => "ok"
    const payload = {
      nested: { title: "Write File" },
      tags: ["file", { kind: "write" }],
      opaque,
      helper,
    }

    keymap.registerLayer({
      commands: [
        {
          name: "save-current",
          payload,
          run() {},
        },
      ],
    })

    payload.nested.title = "Mutated"
    ;(payload.tags[1] as { kind: string }).kind = "mutated"

    const command = getCommand(keymap, "save-current")
    const storedPayload = command?.payload as typeof payload
    expect(storedPayload).toBeDefined()
    expect(storedPayload).toBe(payload)
    expect(storedPayload.nested).toBe(payload.nested)
    expect(storedPayload.tags).toBe(payload.tags)
    expect(storedPayload.tags[1]).toBe(payload.tags[1])
    expect(storedPayload.nested.title).toBe("Mutated")
    expect(storedPayload.tags[1]).toEqual({ kind: "mutated" })
    expect(storedPayload.opaque).toBe(opaque)
    expect(storedPayload.helper).toBe(helper)
  })

  test("keeps active key projections isolated across repeated reads", () => {
    const keymap = getKeymap(renderer)

    keymap.registerLayer({
      commands: [
        {
          name: "save-file",
          desc: "Save the current file",
          title: "Save File",
          category: "File",
          run() {},
        },
      ],
    })

    keymap.registerLayer({
      bindings: [{ key: "x", cmd: "save-file", desc: "Write current file", group: "File" }],
    })

    const plain = getActiveKey(keymap, "x")
    const metadataOnly = getActiveKey(keymap, "x", { includeMetadata: true })
    const withBindings = getActiveKey(keymap, "x", { includeBindings: true })
    const withBindingsAndMetadata = getActiveKey(keymap, "x", { includeBindings: true, includeMetadata: true })
    const plainAgain = getActiveKey(keymap, "x")

    const commandAttrs = {
      desc: "Save the current file",
      title: "Save File",
      category: "File",
    }
    const bindingAttrs = {
      desc: "Write current file",
      group: "File",
    }

    expect(plain?.bindings).toBeUndefined()
    expect(plain?.bindingAttrs).toBeUndefined()
    expect(plain?.commandAttrs).toBeUndefined()
    expect(plain?.command).toBe("save-file")

    expect(metadataOnly?.bindings).toBeUndefined()
    expect(metadataOnly?.command).toBe("save-file")
    expect(metadataOnly?.bindingAttrs).toEqual(bindingAttrs)
    expect(metadataOnly?.commandAttrs).toEqual(commandAttrs)

    expect(withBindings?.bindingAttrs).toBeUndefined()
    expect(withBindings?.commandAttrs).toBeUndefined()
    expect(withBindings?.command).toBe("save-file")
    expect(withBindings?.bindings?.[0]?.attrs).toEqual(bindingAttrs)
    expect(withBindings?.bindings?.[0]?.command).toBe("save-file")
    expect(withBindings?.bindings?.[0]?.commandAttrs).toEqual(commandAttrs)

    expect(withBindingsAndMetadata?.bindingAttrs).toEqual(bindingAttrs)
    expect(withBindingsAndMetadata?.commandAttrs).toEqual(commandAttrs)
    expect(withBindingsAndMetadata?.command).toBe("save-file")
    expect(withBindingsAndMetadata?.bindings?.[0]?.attrs).toEqual(bindingAttrs)
    expect(withBindingsAndMetadata?.bindings?.[0]?.command).toBe("save-file")
    expect(withBindingsAndMetadata?.bindings?.[0]?.commandAttrs).toEqual(commandAttrs)

    expect(plainAgain?.bindings).toBeUndefined()
    expect(plainAgain?.bindingAttrs).toBeUndefined()
    expect(plainAgain?.commandAttrs).toBeUndefined()
    expect(plainAgain?.command).toBe("save-file")
  })
})
