import type { ApprovalPolicy, TaskInput, TaskType } from './task.js'

export interface AutomationSchedule {
  kind: 'daily' | 'weekly'
  time: string
  weekday?: number
}

export interface AutomationTaskTemplate {
  title: string
  goal: string
  type: TaskType
  ownerRole: string
  inputs: TaskInput[]
  constraints: string[]
  deliverables: string[]
  approvalPolicy: ApprovalPolicy
}

export interface Automation {
  id: string
  name: string
  enabled: boolean
  schedule: AutomationSchedule
  taskTemplate: AutomationTaskTemplate
  lastRunAt?: number
}
