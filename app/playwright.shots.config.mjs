// Screenshots only (not part of the suite's counts): npx playwright test -c playwright.shots.config.mjs
import base from './playwright.config.mjs'

export default { ...base, testMatch: ['shots-office.mjs', 'shots-phone.mjs'] }
