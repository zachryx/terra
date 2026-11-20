import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  EmailDto,
  TokenDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SsoGuard } from './guards/sso.guard';
import { CurrentUser } from './decorators/current-user.decorator';

type SsoResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: string };
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, this.getRequestInfo(req));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const result = await this.authService.login(dto, this.getRequestInfo(req));
    this.setCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const token = dto.refreshToken ?? req.cookies?.refresh_token;
    const result = await this.authService.refreshToken(
      token,
      this.getRequestInfo(req),
    );
    this.setCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined;
    const token = req.cookies?.access_token ?? bearer;
    if (token) {
      await this.authService.logout(token, this.getRequestInfo(req));
    }
    this.clearCookies(res);
    return { message: 'Logged out successfully' };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: TokenDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  resendVerification(@Body() dto: EmailDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(@Body() dto: EmailDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto.email, this.getRequestInfo(req));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(
      dto.token,
      dto.password,
      this.getRequestInfo(req),
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return { id: user.id, email: user.email, role: user.role };
  }

  // --- SSO -----------------------------------------------------------------
  // Google: browser redirect flow. Facebook: client sends a Facebook access
  // token (passport-facebook-token), e.g. from the FB JS SDK.

  @Public()
  @Get('google')
  @UseGuards(SsoGuard('google'))
  googleAuth() {
    // Passport redirects to Google.
  }

  @Public()
  @Get('google/callback')
  @UseGuards(SsoGuard('google'))
  googleCallback(@Req() req: Request, @Res() res: Response) {
    const result = req.user as SsoResult;
    this.setCookies(res, result.accessToken, result.refreshToken);
    const frontend = this.config.get('FRONTEND_URL') ?? 'http://localhost:5173';
    return res.redirect(`${String(frontend).replace(/\/$/, '')}/`);
  }

  @Public()
  @Post('facebook')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SsoGuard('facebook'))
  facebookToken(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = req.user as SsoResult;
    this.setCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  private setCookies(res: Response, accessToken: string, refreshToken: string) {
    const options = this.authService.getCookieOptions();
    res.cookie('access_token', accessToken, options.accessToken);
    res.cookie('refresh_token', refreshToken, options.refreshToken);
  }

  private clearCookies(res: Response) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
  }

  private getRequestInfo(req: Request) {
    return {
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };
  }
}
