// API shapes: UNVERIFIED — docs-based. `claude -p "/inspect" --plugin-dir ./plugin`
// ran the command OK but did not write plugin/.claude-plugin/types/claude-code/index.d.ts
// (needs an interactive session). Re-verify $.prompt.submit result, next.origin,
// $.plugin.name/root, $.session.id/cwd, tool.call/turn.complete fields, $.process.run.
export function register(on: any) {
  on('session.start', async ($: any, e: any, next: any) => {
    await $.command.register({
      name: 'inspect',
      description: 'web-inspect: výběr elementů na dev webu',
      argumentHint: '[port|stop]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'inspect' }, async ($: any, e: any) => {
    return { text: 'web-inspect: neaktivní' }
  })
}
