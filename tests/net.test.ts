import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPrivateIp } from '../shared/net.ts';

test('private and reserved addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
    assert.equal(isPrivateIp(ip), true, ip);
});
test('public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});
