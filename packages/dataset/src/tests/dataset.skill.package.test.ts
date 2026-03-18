import { describe, expect, it } from "vitest"
import { buildDatasetSkillPackage } from "../skill"

describe("buildDatasetSkillPackage()", () => {
  it("packages only the skill artifact and excludes heavy test fixtures", () => {
    const skill = buildDatasetSkillPackage()
    expect(skill.name).toBe("dataset")
    expect(skill.files.length).toBeGreaterThan(0)

    const paths = skill.files.map((file) => file.path)
    expect(paths).toContain("SKILL.md")
    expect(paths).toContain("skill.toml")
    expect(paths).toContain("code/query_to_jsonl.mjs")
    expect(paths).toContain("code/complete_dataset.mjs")
    expect(paths.some((filePath) => filePath.includes(".xlsx"))).toBe(false)
    expect(paths.some((filePath) => filePath.includes("/tests/"))).toBe(false)
    expect(paths.some((filePath) => filePath.endsWith(".csv"))).toBe(false)
  })
})
