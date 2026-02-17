import { uppercaseStep } from '../steps/uppercase';

export async function testWorkflow(input: { input: string }) {
  "use workflow"

  const upper = await uppercaseStep({ text: input.input });

  return {
    ok: true,
    workflow: 'library:workbench',
    echo: input.input,
    upper,
    stepProcessed: true,
  };
}




















