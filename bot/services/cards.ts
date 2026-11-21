import { AttachmentBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export interface CardOpts { title: string; subtitle: string; detail?: string; avatarUrl: string; progress?: number }

/** Purple-themed card. Returns null on failure so callers can fall back to a plain embed. */
export async function card(o: CardOpts): Promise<AttachmentBuilder | null> {
  try {
    const W = 900, H = 300;
    const c = createCanvas(W, H);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#09090F'); grad.addColorStop(1, '#171323');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = '#6D28D9'; g.fillRect(0, 0, 10, H);
    const res = await fetch(o.avatarUrl);
    const img = await loadImage(Buffer.from(await res.arrayBuffer()));
    g.save(); g.beginPath(); g.arc(150, 150, 90, 0, Math.PI * 2); g.closePath(); g.clip();
    g.drawImage(img, 60, 60, 180, 180); g.restore();
    g.lineWidth = 6; g.strokeStyle = '#9333EA'; g.beginPath(); g.arc(150, 150, 93, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#FFFFFF'; g.font = 'bold 40px sans-serif'; g.fillText(o.title.slice(0, 26), 280, 115);
    g.fillStyle = '#C4B5FD'; g.font = '26px sans-serif'; g.fillText(o.subtitle.slice(0, 44), 280, 160);
    if (o.detail) { g.fillStyle = '#A1A1AA'; g.font = '22px sans-serif'; g.fillText(o.detail.slice(0, 50), 280, 200); }
    if (o.progress !== undefined) {
      g.fillStyle = '#171323'; g.fillRect(280, 235, 560, 18);
      g.fillStyle = '#9333EA'; g.fillRect(280, 235, Math.max(4, 560 * Math.min(1, o.progress)), 18);
    }
    return new AttachmentBuilder(await c.encode('png'), { name: 'card.png' });
  } catch (e) {
    console.error('[card]', e);
    return null;
  }
}
