import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-facebook-token';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { SsoProvider } from '@prisma/client';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      clientID: configService.get('FACEBOOK_CLIENT_ID') || '',
      clientSecret: configService.get('FACEBOOK_CLIENT_SECRET') || '',
      callbackURL:
        configService.get('FACEBOOK_CALLBACK_URL') || '/auth/facebook/callback',
      profileFields: ['emails', 'displayName', 'picture'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: any,
  ): Promise<any> {
    const user = await this.authService.handleSsoCallback(
      SsoProvider.FACEBOOK,
      {
        providerId: profile.id,
        email: profile.emails?.[0]?.value || `${profile.id}@facebook.local`,
        name: profile.displayName,
        avatar: profile.photos?.[0]?.value,
      },
    );

    done(null, user);
  }
}
