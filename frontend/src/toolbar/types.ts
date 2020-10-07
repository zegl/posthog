import { ActionStepType, ActionType, ElementType } from '~/types'
import { NamePath, StoreValue } from 'rc-field-form/es/interface'

export type ElementsEventType = {
    count: number
    elements: ElementType[]
    hash: string
}

export interface HeatmapElement {
    count: number
    element: HTMLElement
    selector: string
    position: number
    actionStep?: ActionStepType
}

export interface HeatmapElementWithRect extends HeatmapElement {
    rect: DOMRect
}

export interface InspectElement {
    element: HTMLElement
}

export interface InspectElementWithRect extends InspectElement {
    rect: DOMRect
}

export interface SelectedActionElementWithRect {
    element: HTMLElement
    stepIndex: number
    rect?: DOMRect
}

export interface ActionElementWithRect {
    element: HTMLElement
    rect?: DOMRect
    actionIndex: number
    action: ActionType
    step?: ActionStepType
}

export interface ElementWithMetadata {
    element: HTMLElement
    rect?: DOMRect
    index?: number
    count?: number
}

export interface ActionElementWithMetadata extends ElementWithMetadata {
    action?: ActionType
    step?: ActionStepType
}

export type ActionElementMap = Map<HTMLElement, ActionElementWithMetadata[]>
export type ElementMap = Map<HTMLElement, ElementWithMetadata | (ElementWithMetadata & HeatmapElementWithRect)>
export interface SelectedElementMeta extends ElementWithMetadata {
    actionStep: ActionStepType
    actions: ActionElementWithMetadata[]
}
export type BoxColor = {
    backgroundBlendMode: string
    background: string
    boxShadow: string
}

export interface ActionStepForm extends ActionStepType {
    href_selected?: boolean
    text_selected?: boolean
    selector_selected?: boolean
    url_selected?: boolean
}

export interface ActionForm extends ActionType {
    steps?: ActionStepForm[]
}

export interface AntdFieldData {
    touched?: boolean
    validating?: boolean
    errors?: string[]
    value?: StoreValue
    name: NamePath
}
