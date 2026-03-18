export type ContextSkillPackageFile = {
  path: string
  contentBase64: string
}

export type ContextSkillPackage = {
  name: string
  description?: string
  files: ContextSkillPackageFile[]
}
