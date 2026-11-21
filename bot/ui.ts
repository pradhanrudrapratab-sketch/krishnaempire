import { EmbedBuilder, type BaseMessageOptions } from 'discord.js';

export const COLORS = { bg: 0x09090f, primary: 0x6d28d9, accent: 0x9333ea, light: 0xc4b5fd, error: 0xb91c1c };

export function panel(title: string, description: string, tone: 'info' | 'ok' | 'error' = 'info'): BaseMessageOptions {
  const color = tone === 'error' ? COLORS.error : tone === 'ok' ? COLORS.accent : COLORS.primary;
  return { embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp()] };
}

export function logEmbed(title: string, description: string, color: number = COLORS.primary) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description.slice(0, 4000)).setTimestamp();
}
