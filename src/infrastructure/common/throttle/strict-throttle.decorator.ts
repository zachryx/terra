import { SetMetadata } from '@nestjs/common';

export const STRICT_THROTTLE_KEY = 'strict-throttle';

/** Marks a route as sensitive: the "strict" throttler (low limit) applies to it. */
export const StrictThrottle = () => SetMetadata(STRICT_THROTTLE_KEY, true);
