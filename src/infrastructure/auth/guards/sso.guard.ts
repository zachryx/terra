import {
  ExecutionContext,
  Injectable,
  NotFoundException,
  Type,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

/**
 * Passport guard for an optional SSO provider. When the provider has no
 * credentials configured, the route behaves as if it doesn't exist.
 */
export function SsoGuard(provider: 'google' | 'facebook'): Type<any> {
  @Injectable()
  class ProviderGuard extends AuthGuard(provider) {
    constructor(private config: ConfigService) {
      super();
    }

    canActivate(context: ExecutionContext) {
      const id = this.config.get(`${provider.toUpperCase()}_CLIENT_ID`);
      const secret = this.config.get(`${provider.toUpperCase()}_CLIENT_SECRET`);
      if (!id || !secret) {
        throw new NotFoundException(`${provider} sign-in is not configured`);
      }
      return super.canActivate(context);
    }
  }
  return ProviderGuard;
}
