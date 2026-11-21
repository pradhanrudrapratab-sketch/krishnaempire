import type { CommandDef } from '../framework';
import { moduleCommands } from '../modules';
import { permission } from './admin/permission';
import { prefix } from './admin/prefix';
import { role } from './admin/role';
import { help } from './utility/help';
import { serverinfo, status, userinfo } from './utility/info';
import { ping } from './utility/ping';

// Discord allows max 100 slash commands per guild.
export const commands: CommandDef[] = [help, ping, serverinfo, userinfo, status, prefix, role, permission, ...moduleCommands];
