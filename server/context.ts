import { AsyncLocalStorage } from 'async_hooks';
import type { ChannelInfos } from '@server/app/container/console';

export default new AsyncLocalStorage<ChannelInfos>();