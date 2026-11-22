// Opens the health port first (Render checks for it quickly), then loads the bot.
import { startHealth } from './health';

startHealth();
await import('./index');
