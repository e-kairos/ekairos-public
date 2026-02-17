export async function uppercaseStep(input: { text: string }) {
  "use step"

  return `[STEP-PROCESSED] ${input.text.toUpperCase()}`;
}




















