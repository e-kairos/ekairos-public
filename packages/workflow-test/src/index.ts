export interface WorkflowTestStepInput {
  message: string;
}

export interface WorkflowTestStepResult {
  processedMessage: string;
}

export async function workflowTestStep(input: WorkflowTestStepInput): Promise<WorkflowTestStepResult> {
  "use step"

  const trimmedMessage = input.message.trim();
  const uppercaseMessage = trimmedMessage.toUpperCase();
  const stepResult: WorkflowTestStepResult = {
    processedMessage: `[workflow-step] ${uppercaseMessage}`
  };

  return stepResult;
}

export interface WorkflowTestInput {
  message: string;
}

export interface WorkflowTestOutput {
  originalMessage: string;
  step: WorkflowTestStepResult;
  executedAt: string;
}

export async function workflowTest(input: WorkflowTestInput): Promise<WorkflowTestOutput> {
  "use workflow"

  const stepInput: WorkflowTestStepInput = {
    message: input.message
  };
  const stepOutput = await workflowTestStep(stepInput);
  const executedAt = new Date().toISOString();
  const workflowResult: WorkflowTestOutput = {
    originalMessage: input.message,
    step: stepOutput,
    executedAt: executedAt
  };

  return workflowResult;
}














