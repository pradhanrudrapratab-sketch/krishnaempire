import net from 'node:net';

/** True for loopback / private / link-local / reserved addresses (SSRF protection). */
export function isPrivateIp(ip: string): boolean {
  if (ip.toLowerCase().startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  if (!net.isIPv4(ip)) return true;
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
