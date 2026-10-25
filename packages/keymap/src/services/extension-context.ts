import type { ActivationService } from "./activation.js"
import type { CommandCatalogService } from "./command-catalog.js"
import type { ConditionService } from "./conditions.js"
import type { LayerService } from "./layers.js"
import type { State } from "./state.js"
import type { KeymapEvent, KeymapHost, Layer, RegisteredLayer } from "../types.js"

export const KEYMAP_EXTENSION_CONTEXT = Symbol("keymap-extension-context")

export interface KeymapExtensionContext<TTarget extends object, TEvent extends KeymapEvent> {
  state: State<TTarget, TEvent>
  host: KeymapHost<TTarget, TEvent>
  conditions: ConditionService<TTarget, TEvent>
  catalog: CommandCatalogService<TTarget, TEvent>
  activation: ActivationService<TTarget, TEvent>
  layers: LayerService<TTarget, TEvent>
}

export interface KeymapExtensionProvider<TTarget extends object, TEvent extends KeymapEvent> {
  [KEYMAP_EXTENSION_CONTEXT](): KeymapExtensionContext<TTarget, TEvent>
}

// Holds one layer registration that the adapters' `useBindings` replace on every update.
export function createLayerSlot<TTarget extends object, TEvent extends KeymapEvent>(
  keymap: KeymapExtensionProvider<TTarget, TEvent>,
): (layer: Layer<TTarget, TEvent> | undefined) => void {
  const { layers } = keymap[KEYMAP_EXTENSION_CONTEXT]()
  let registered: RegisteredLayer<TTarget, TEvent> | undefined
  return (layer) => {
    registered = layers.replaceLayer(registered, layer)
  }
}
