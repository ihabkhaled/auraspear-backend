const buildTscCommand = () => 'npm run typecheck'
const buildLintCommand = () => 'npm run lint:fix'
const buildPrettierCommand = () => 'npm run format'

module.exports = {
  '*.ts': (files) => {
    if (!files.length) return []

    return [
      buildLintCommand(),
      buildTscCommand(),
    ]
  },

  '*.{ts,json,md,yml,yaml}': (files) => {
    if (!files.length) return []

    return [buildPrettierCommand()]
  },
}