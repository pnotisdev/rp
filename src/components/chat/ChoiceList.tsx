import type { ChoiceOption } from '@/lib/types'

interface ChoiceListProps {
  choices: ChoiceOption[]
  onPick: (choice: ChoiceOption) => void
  onRefresh: () => void
  refreshing: boolean
}

/** The "what happens next" prompt shown above the composer once a reply lands — picking one sends it and moves the scene forward. */
export function ChoiceList({ choices, onPick, onRefresh, refreshing }: ChoiceListProps) {
  return (
    <div className="mx-auto flex w-full max-w-chat flex-col gap-2 px-4 pb-3">
      {choices.map((choice, i) => (
        <button
          key={choice.id || i}
          onClick={() => onPick(choice)}
          className="themed-shadow rounded-2xl border border-border bg-bg-elevated px-4 py-2.5 text-left text-sm text-text transition-colors hover:border-accent hover:bg-accent/10"
        >
          <span className="mr-2 font-mono text-xs text-accent">{i + 1}</span>
          <span className="mr-1 rounded-md bg-bg-sunken px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
            {choice.kind === 'gift' ? 'Gift' : choice.kind === 'action' ? 'Action' : 'Line'}
          </span>
          {choice.label}
          {choice.kind === 'gift' && choice.giftName && (
            <span className="ml-2 text-xs text-text-muted">({choice.giftName})</span>
          )}
        </button>
      ))}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="self-start text-xs text-text-muted transition-colors hover:text-text disabled:opacity-40"
      >
        {refreshing ? 'Thinking of other options…' : '⟲ Different options'}
      </button>
    </div>
  )
}
