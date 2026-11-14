import type { SteeringView } from "../steering/index.js"
import { widgetFormat } from "../steering/internal.js"

/** The phone screen's one read: a steering file's widgets and prose. */
export const steeringViewFor = (content: string): SteeringView => widgetFormat.view(content)
