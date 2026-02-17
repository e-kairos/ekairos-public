#!/usr/bin/env node

const run = async () => {
  try {
    await import("ekairos-cli/dist/index.js")
  } catch (error) {
    console.error("[ekairos] No se pudo iniciar el CLI:", error)
    process.exit(1)
  }
}

run()


