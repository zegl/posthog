import React from 'react'
import { useActions, useValues } from 'kea'
import { ActionStep } from '~/toolbar/elements/ActionStep'
import { CalendarOutlined, PlusOutlined } from '@ant-design/icons'
import { heatmapLogic } from '~/toolbar/elements/heatmapLogic'
import { Button, Statistic, Row, Col } from 'antd'
import { elementsLogic } from '~/toolbar/elements/elementsLogic'
import { ActionsListView } from '~/toolbar/actions/ActionsListView'
import { ActionType } from '~/types'

export function ElementInfo(): JSX.Element | null {
    const { clickCount } = useValues(heatmapLogic)

    const { selectedElementMeta } = useValues(elementsLogic)
    const { createAction } = useActions(elementsLogic)

    if (!selectedElementMeta) {
        return null
    }

    const { element, position, count, actionStep } = selectedElementMeta

    return (
        <>
            <div style={{ padding: 15, borderLeft: '5px solid #8F98FF', background: 'hsla(235, 100%, 99%, 1)' }}>
                <h1 className="section-title">Selected Element</h1>
                <ActionStep actionStep={actionStep} />
            </div>

            {position ? (
                <div style={{ padding: 15, borderLeft: '5px solid #FF9870', background: 'hsla(19, 99%, 99%, 1)' }}>
                    <h1 className="section-title">Stats</h1>
                    <p>
                        <CalendarOutlined /> <u>Last 7 days</u>
                    </p>
                    <Row gutter={16}>
                        <Col span={16}>
                            <Statistic
                                title="Clicks"
                                value={count || 0}
                                suffix={`/ ${clickCount} (${
                                    clickCount === 0 ? '-' : Math.round(((count || 0) / clickCount) * 10000) / 100
                                }%)`}
                            />
                        </Col>
                        <Col span={8}>
                            <Statistic title="Ranking" prefix="#" value={position || 0} />
                        </Col>
                    </Row>
                </div>
            ) : null}

            <div style={{ padding: 15, borderLeft: '5px solid #94D674', background: 'hsla(100, 74%, 98%, 1)' }}>
                <h1 className="section-title">Actions ({selectedElementMeta.actions.length})</h1>

                {selectedElementMeta.actions.length === 0 ? (
                    <p>No actions include this element</p>
                ) : (
                    <ActionsListView
                        actions={selectedElementMeta.actions.map((a) => a.action).filter((a) => !!a) as ActionType[]}
                    />
                )}

                <Button size="small" onClick={() => createAction(element)}>
                    <PlusOutlined /> Create a new action
                </Button>
            </div>
        </>
    )
}
