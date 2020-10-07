import { kea } from 'kea'

import { actionsLogic } from '~/toolbar/actions/actionsLogic'
import { heatmapLogic } from '~/toolbar/elements/heatmapLogic'
import { elementToActionStep, getAllClickTargets, getElementForStep, getRectForElement } from '~/toolbar/utils'
import { actionsTabLogic } from '~/toolbar/actions/actionsTabLogic'
import { toolbarButtonLogic } from '~/toolbar/button/toolbarButtonLogic'
import { elementsLogicType } from 'types/toolbar/elements/elementsLogicType'
import { ActionStepType, ActionType } from '~/types'
import {
    ActionForm,
    ActionElementMap,
    ElementMap,
    SelectedElementMeta,
    InspectElementWithRect,
    HeatmapElementWithRect,
    SelectedActionElementWithRect,
    ActionElementWithRect,
} from '~/toolbar/types'
import { currentPageLogic } from '~/toolbar/stats/currentPageLogic'
import { toolbarLogic } from '~/toolbar/toolbarLogic'

export const elementsLogic = kea<
    elementsLogicType<
        ActionStepType,
        ActionForm,
        ActionType,
        ActionElementMap,
        ElementMap,
        SelectedElementMeta,
        HeatmapElementWithRect,
        InspectElementWithRect,
        SelectedActionElementWithRect,
        ActionElementWithRect
    >
>({
    actions: {
        enableInspect: true,
        disableInspect: true,

        selectElement: (element: HTMLElement | null) => ({ element }),
        createAction: (element: HTMLElement) => ({ element }),

        updateRects: true,
        setHoverElement: (element: HTMLElement | null) => ({ element }),
        setHighlightElement: (element: HTMLElement | null) => ({ element }),
        setSelectedElement: (element: HTMLElement | null) => ({ element }),
    },

    reducers: () => ({
        inspectEnabledRaw: [
            false,
            {
                enableInspect: () => true,
                disableInspect: () => false,
            },
        ],
        rectUpdateCounter: [
            0,
            {
                updateRects: (state) => state + 1,
            },
        ],
        hoverElement: [
            null as HTMLElement | null,
            {
                setHoverElement: (_, { element }) => element,
                enableInspect: () => null,
                disableInspect: () => null,
                createAction: () => null,
            },
        ],
        highlightElement: [
            null as HTMLElement | null,
            {
                setHighlightElement: (_, { element }) => element,
                setHoverElement: () => null,
                setSelectedElement: () => null,
                selectElement: () => null,
                disableInspect: () => null,
                createAction: () => null,
            },
        ],
        selectedElement: [
            null as HTMLElement | null,
            {
                setSelectedElement: (state, { element }) => (state === element ? null : element),
                disableInspect: () => null,
                createAction: () => null,
                [heatmapLogic.actionTypes.disableHeatmap]: () => null,
                [actionsTabLogic.actionTypes.selectAction]: () => null,
            },
        ],
        enabledLast: [
            null as null | 'inspect' | 'heatmap',
            {
                // keep track of what to disable first with ESC
                enableInspect: () => 'inspect',
                [heatmapLogic.actionTypes.enableHeatmap]: () => 'heatmap',
            },
        ],
    }),

    selectors: {
        inspectEnabled: [
            (s) => [
                s.inspectEnabledRaw,
                actionsTabLogic.selectors.inspectingElement,
                actionsTabLogic.selectors.buttonActionsVisible,
            ],
            (inpsectEnabledRaw, inspectingElement, buttonActionsVisible) =>
                inpsectEnabledRaw || (buttonActionsVisible && inspectingElement !== null),
        ],

        heatmapEnabled: [() => [heatmapLogic.selectors.heatmapEnabled], (heatmapEnabled) => heatmapEnabled],

        heatmapElements: [
            (s) => [heatmapLogic.selectors.countedElements, s.rectUpdateCounter, toolbarLogic.selectors.buttonVisible],
            (countedElements) => {
                return countedElements.map(
                    (e) => ({ ...e, rect: getRectForElement(e.element) } as HeatmapElementWithRect)
                )
            },
        ],

        allInspectElements: [
            (s) => [s.inspectEnabled, currentPageLogic.selectors.href],
            (inspectEnabled) => (inspectEnabled ? getAllClickTargets() : []),
        ],

        inspectElements: [
            (s) => [s.allInspectElements, s.rectUpdateCounter, toolbarLogic.selectors.buttonVisible],
            (allInspectElements) =>
                allInspectElements
                    .map((element) => ({ element, rect: getRectForElement(element) } as InspectElementWithRect))
                    .filter((e) => e.rect && e.rect.width * e.rect.height > 0),
        ],

        displayActionElements: [
            () => [actionsTabLogic.selectors.buttonActionsVisible],
            (buttonActionsVisible) => buttonActionsVisible,
        ],

        allSelectedActionElements: [
            (s) => [s.displayActionElements, actionsTabLogic.selectors.selectedEditedAction],
            (displayActionElements, selectedEditedAction) => {
                const steps: SelectedActionElementWithRect[] = []
                if (displayActionElements && selectedEditedAction?.steps) {
                    selectedEditedAction.steps.forEach((step, stepIndex) => {
                        const element = getElementForStep(step)
                        if (element) {
                            steps.push({
                                element,
                                stepIndex,
                            })
                        }
                    })
                    return steps
                }
                return steps
            },
        ],

        selectedActionElements: [
            (s) => [s.allSelectedActionElements, s.rectUpdateCounter, toolbarLogic.selectors.buttonVisible],
            (allSelectedActionElements) => {
                return allSelectedActionElements.map((element) =>
                    element.element ? { ...element, rect: getRectForElement(element.element) } : element
                )
            },
        ],

        actionsForElementMap: [
            (s) => [actionsLogic.selectors.sortedActions, s.rectUpdateCounter, toolbarLogic.selectors.buttonVisible],
            (sortedActions): ActionElementMap => {
                const actionsForElementMap = new Map<HTMLElement, ActionElementWithRect[]>()
                sortedActions.forEach((action, actionIndex) => {
                    action.steps
                        ?.filter((step) => step.event === '$autocapture')
                        .forEach((step) => {
                            const element = getElementForStep(step)
                            if (element) {
                                const rect = getRectForElement(element)
                                let array = actionsForElementMap.get(element)
                                if (!array) {
                                    array = []
                                    actionsForElementMap.set(element, array)
                                }
                                array.push({ action, step, element, rect, actionIndex })
                            }
                        })
                })
                return actionsForElementMap
            },
        ],

        actionsListElements: [
            (s) => [s.actionsForElementMap],
            (actionsForElementMap) =>
                [...((actionsForElementMap.values() as unknown) as ActionElementWithRect[][])].map((a) => a[0]),
        ],

        elementMap: [
            (s) => [s.heatmapElements, s.inspectElements, s.selectedActionElements, s.actionsListElements],
            (heatmapElements, inspectElements, selectedActionElements, actionsListElements): ElementMap => {
                const elementMap: ElementMap = new Map()

                inspectElements.forEach((e) => {
                    elementMap.set(e.element, e)
                })
                heatmapElements.forEach((e) => {
                    if (elementMap.get(e.element)) {
                        elementMap.set(e.element, { ...elementMap.get(e.element), ...e })
                    } else {
                        elementMap.set(e.element, e)
                    }
                })
                ;[...selectedActionElements, ...actionsListElements].forEach((e) => {
                    if (elementMap.get(e.element)) {
                        elementMap.set(e.element, { ...elementMap.get(e.element), ...e })
                    } else {
                        elementMap.set(e.element, e)
                    }
                })
                return elementMap
            },
        ],

        elementsToDisplayRaw: [
            (s) => [
                s.displayActionElements,
                s.selectedActionElements,
                s.inspectElements,
                s.actionsListElements,
                actionsTabLogic.selectors.selectedAction,
            ],
            (displayActionElements, selectedActionElements, inspectElements, actionsListElements, selectedAction) => {
                if (inspectElements.length > 0) {
                    return inspectElements
                }
                if (displayActionElements && selectedAction && selectedActionElements.length > 0) {
                    return selectedActionElements
                }
                if (displayActionElements && !selectedAction && actionsListElements.length > 0) {
                    return actionsListElements
                }
                return []
            },
        ],

        elementsToDisplay: [
            (s) => [s.elementsToDisplayRaw],
            (elementsToDisplayRaw) => {
                return elementsToDisplayRaw.filter(({ rect }) => rect && (rect.width !== 0 || rect.height !== 0))
            },
        ],

        labelsToDisplay: [
            (s) => [
                s.displayActionElements,
                s.selectedActionElements,
                s.actionsListElements,
                actionsTabLogic.selectors.selectedAction,
            ],
            (displayActionElements, selectedActionElements, actionsListElements, selectedAction) => {
                if (displayActionElements && selectedAction && selectedActionElements.length > 0) {
                    return selectedActionElements
                }
                if (displayActionElements && !selectedAction && actionsListElements.length > 0) {
                    return actionsListElements
                }
                return []
            },
        ],

        selectedElementMeta: [
            (s) => [s.selectedElement, s.elementMap, s.actionsForElementMap],
            (selectedElement, elementMap, actionsForElementMap) => {
                if (selectedElement) {
                    const meta = elementMap.get(selectedElement)
                    if (meta) {
                        const actions = actionsForElementMap.get(selectedElement)
                        return {
                            ...meta,
                            actionStep: elementToActionStep(meta.element),
                            actions: actions || [],
                        } as SelectedElementMeta
                    }
                }
                return null
            },
        ],

        hoverElementMeta: [
            (s) => [s.hoverElement, s.elementMap, s.actionsForElementMap],
            (hoverElement, elementMap, actionsForElementMap) => {
                if (hoverElement) {
                    const meta = elementMap.get(hoverElement)
                    if (meta) {
                        const actions = actionsForElementMap.get(hoverElement)
                        return {
                            ...meta,
                            actionStep: elementToActionStep(meta.element),
                            actions: actions || [],
                        } as SelectedElementMeta
                    }
                }
                return null
            },
        ],

        highlightElementMeta: [
            (s) => [s.highlightElement, s.elementMap, s.actionsForElementMap],
            (highlightElement, elementMap, actionsForElementMap) => {
                if (highlightElement) {
                    const meta = elementMap.get(highlightElement)
                    if (meta) {
                        const actions = actionsForElementMap.get(highlightElement)
                        return {
                            ...meta,
                            actionStep: elementToActionStep(meta.element),
                            actions: actions || [],
                        } as SelectedElementMeta
                    }
                }
                return null
            },
        ],
    },

    events: ({ cache, values, actions }) => ({
        afterMount: () => {
            cache.onClick = () => actions.updateRects()
            cache.onScrollResize = () => {
                window.clearTimeout(cache.clickDelayTimeout)
                actions.updateRects()
                cache.clickDelayTimeout = window.setTimeout(actions.updateRects, 100)
            }
            cache.onKeyDown = (e: KeyboardEvent) => {
                if (e.keyCode !== 27) {
                    return
                }
                if (values.hoverElement) {
                    actions.setHoverElement(null)
                }
                if (values.selectedElement) {
                    actions.setSelectedElement(null)
                    return
                }
                if (values.enabledLast === 'heatmap' && values.heatmapEnabled) {
                    heatmapLogic.actions.disableHeatmap()
                    return
                }
                if (values.inspectEnabled) {
                    actions.disableInspect()
                    return
                }
                if (values.heatmapEnabled) {
                    heatmapLogic.actions.disableHeatmap()
                    return
                }
            }
            window.addEventListener('click', cache.onClick)
            window.addEventListener('resize', cache.onScrollResize)
            window.addEventListener('keydown', cache.onKeyDown)
            window.document.addEventListener('scroll', cache.onScrollResize, true)
        },
        beforeUnmount: () => {
            window.removeEventListener('click', cache.onClick)
            window.removeEventListener('resize', cache.onScrollResize)
            window.removeEventListener('keydown', cache.onKeyDown)
            window.document.removeEventListener('scroll', cache.onScrollResize, true)
        },
    }),

    listeners: ({ actions }) => ({
        enableInspect: () => {
            actionsLogic.actions.getActions()
        },
        selectElement: ({ element }) => {
            const inpsectForAction =
                actionsTabLogic.values.buttonActionsVisible && actionsTabLogic.values.inspectingElement !== null

            if (inpsectForAction) {
                actions.setHoverElement(null)
                if (element) {
                    actionsTabLogic.actions.inspectElementSelected(element, actionsTabLogic.values.inspectingElement)
                }
            } else {
                actions.setSelectedElement(element)
            }
        },
        createAction: ({ element }) => {
            actionsTabLogic.actions.showButtonActions()
            toolbarButtonLogic.actions.showActionsInfo()
            elementsLogic.actions.selectElement(null)
            actionsTabLogic.actions.newAction(element)
        },
    }),
})
