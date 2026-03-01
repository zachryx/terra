import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpStatus,
  UseGuards,
  Redirect,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const requestInfo = this.getRequestInfo(req);
    const result = await this.authService.register(dto, requestInfo);

    this.setCookies(res, result.accessToken, result.refreshToken);

    return res.status(HttpStatus.CREATED).json({
      user: result.user,
    });
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const requestInfo = this.getRequestInfo(req);
    const result = await this.authService.login(dto, requestInfo);

    this.setCookies(res, result.accessToken, result.refreshToken);

    return res.status(HttpStatus.OK).json({
      user: result.user,
    });
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const requestInfo = this.getRequestInfo(req);
    const result = await this.authService.refreshToken(
      dto.refreshToken,
      requestInfo,
    );

    this.setCookies(res, result.accessToken, result.refreshToken);

    return res.status(HttpStatus.OK).json({
      user: result.user,
    });
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const token = req.cookies?.access_token;
    const requestInfo = this.getRequestInfo(req);

    if (token) {
      await this.authService.logout(token, requestInfo);
    }

    this.clearCookies(res);

    return res
      .status(HttpStatus.OK)
      .json({ message: 'Logged out successfully' });
  }

  @Public()
  @Get('google')
  @UseGuards()
  async googleAuth() {}

  @Public()
  @Get('google/callback')
  @UseGuards()
  @Redirect()
  async googleAuthRedirect(@Req() req: Request) {
    return { url: '/dashboard' };
  }

  @Public()
  @Get('facebook')
  @UseGuards()
  async facebookAuth() {}

  @Public()
  @Get('facebook/callback')
  @UseGuards()
  @Redirect()
  async facebookAuthRedirect(@Req() req: Request) {
    return { url: '/dashboard' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(@Body('token') token: string) {
    return this.authService.verifyEmail(token);
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
