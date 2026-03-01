# Authentication & User Management

## Overview

Secure user authentication and role-based access control system for the platform.

## Features

### User Registration

- Email and password registration
- Email verification
- Social login (Google, Facebook) - future

### User Roles

| Role      | Permissions                                    |
| --------- | ---------------------------------------------- |
| Admin     | Full system access, user management            |
| Organizer | Create/manage events, view analytics           |
| Sponsor   | View assigned events, access sponsor dashboard |
| Attendee  | Purchase tickets, view own tickets             |

### Profile Management

- Update profile information
- Change password
- Profile picture upload

### Security

- JWT-based authentication
- Password hashing (bcrypt)
- Session management
- Rate limiting on auth endpoints
