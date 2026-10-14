// Bundled example extensions, installable from the Extensions screen.

import type { ExtensionBundle } from '../manifest'
import { adventureKit } from './adventureKit'
import { diceTray } from './diceTray'
import { fateOracle } from './fateOracle'
import { focusDesk } from './focusDesk'
import { languageLab } from './languageLab'
import { lorekeeper } from './lorekeeper'
import { midnightGlass } from './midnightGlass'
import { questJournal } from './questJournal'
import { relationshipHud } from './relationshipHud'
import { slashCommands } from './slashCommands'
import { storyInsights } from './storyInsights'
import { ticTacToe } from './ticTacToe'

export const EXAMPLE_BUNDLES: ExtensionBundle[] = [slashCommands, adventureKit, lorekeeper, fateOracle, languageLab, storyInsights, diceTray, questJournal, relationshipHud, ticTacToe, focusDesk, midnightGlass]
