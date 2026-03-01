module.exports = {
  '*.ts': [() => 'npm run lint:fix', () => 'npm run typecheck'],
  '*.{ts,json,md,yml,yaml}': [() => 'npm run format'],
}
