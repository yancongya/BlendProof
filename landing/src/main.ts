/**
 * Landing page entry — boot sequence.
 *
 * Imports and initialises all feature modules.
 * All logic lives in ./modules/*; this file only orchestrates.
 */

import { initHero3D } from './hero3d'
import { applyStaticI18n } from './i18n'
import { init as initToggles } from './modules/toggles'
import { init as initDemos } from './modules/demos'
import { init as initCards } from './modules/cards'
import { init as initTarot } from './modules/tarot'
import { init as initStats } from './modules/stats'

applyStaticI18n()
initToggles()
initTarot()
initHero3D()
initDemos()
initCards()
void initStats()