# Tasks - Promo Code Feature

## Task Key: PROMO8A1B

### Overview

Implement promo codes and discounts feature for the ticketing platform.

### Tasks

#### 1. Prisma Schema Enhancement

- [ ] Add PromoCode model to schema
- [ ] Add PromoCodeUsage model to track usage
- [ ] Create migration

#### 2. Domain Layer

- [ ] Create PromoCode entity
- [ ] Create PromoCodeUsage entity
- [ ] Create IPromoCodeRepository interface
- [ ] Create IPromoCodeUsageRepository interface

#### 3. Infrastructure Layer

- [ ] Implement PromoCodeRepository
- [ ] Implement PromoCodeUsageRepository
- [ ] Create PromoCodeController

#### 4. Application Layer

- [ ] Create PromoCodeUseCases
- [ ] Implement discount calculation logic
- [ ] Implement usage limit validation

#### 5. API Endpoints

- [ ] POST /promo-codes - Create promo code
- [ ] GET /promo-codes - List promo codes
- [ ] GET /promo-codes/:id - Get promo code details
- [ ] PUT /promo-codes/:id - Update promo code
- [ ] DELETE /promo-codes/:id - Delete promo code
- [ ] POST /promo-codes/validate - Validate promo code

---

## Task Key: PROMO8A1B - Dependencies

- Requires: Authentication (COMPLETED)
- Requires: Ticket Management (COMPLETED)
