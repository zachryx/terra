-- Enums
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "TicketType" AS ENUM ('GENERAL', 'VIP', 'EARLY_BIRD', 'GROUP');
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');
CREATE TYPE "IssuedTicketStatus" AS ENUM ('VALID', 'CHECKED_IN', 'VOID');

-- Event.status String -> enum
ALTER TABLE "Event" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Event" ALTER COLUMN "status" TYPE "EventStatus" USING (
  CASE WHEN "status" IN ('DRAFT','PUBLISHED','CANCELLED','COMPLETED') THEN "status" ELSE 'DRAFT' END
)::"EventStatus";
ALTER TABLE "Event" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
CREATE INDEX "Event_organizerId_idx" ON "Event"("organizerId");
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- Ticket: type enum, price -> integer minor units (x100)
ALTER TABLE "Ticket" ALTER COLUMN "ticketType" DROP DEFAULT;
ALTER TABLE "Ticket" ALTER COLUMN "ticketType" TYPE "TicketType" USING (
  CASE WHEN "ticketType" IN ('GENERAL','VIP','EARLY_BIRD','GROUP') THEN "ticketType" ELSE 'GENERAL' END
)::"TicketType";
ALTER TABLE "Ticket" ALTER COLUMN "ticketType" SET DEFAULT 'GENERAL';
ALTER TABLE "Ticket" ALTER COLUMN "price" TYPE INTEGER USING ROUND("price" * 100)::INTEGER;

-- Stock can never go negative or exceed capacity, regardless of application logic
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_sold_within_quantity"
  CHECK ("sold" >= 0 AND "sold" <= "quantity");

-- Order money -> integer minor units; reference, currency, expiry
ALTER TABLE "Order" ALTER COLUMN "totalAmount" TYPE INTEGER USING ROUND("totalAmount" * 100)::INTEGER;
ALTER TABLE "Order" ALTER COLUMN "discountAmount" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "discountAmount" TYPE INTEGER USING ROUND("discountAmount" * 100)::INTEGER;
ALTER TABLE "Order" ALTER COLUMN "discountAmount" SET DEFAULT 0;
ALTER TABLE "Order" ALTER COLUMN "finalAmount" TYPE INTEGER USING ROUND("finalAmount" * 100)::INTEGER;
ALTER TABLE "Order" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Order" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "reference" TEXT;
UPDATE "Order" SET "reference" = 'ORD-' || UPPER(SUBSTRING(REPLACE("id", '-', '') FROM 1 FOR 10)) WHERE "reference" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "reference" SET NOT NULL;
CREATE UNIQUE INDEX "Order_reference_key" ON "Order"("reference");

-- OrderItem.price
ALTER TABLE "OrderItem" ALTER COLUMN "price" TYPE INTEGER USING ROUND("price" * 100)::INTEGER;

-- PromoCode: enum + integer values
-- (percentage values are whole percents and keep their magnitude; fixed amounts become minor units)
ALTER TABLE "PromoCode" ALTER COLUMN "discountType" DROP DEFAULT;
ALTER TABLE "PromoCode" ALTER COLUMN "discountType" TYPE "DiscountType" USING (
  CASE WHEN "discountType" = 'FIXED' THEN 'FIXED' ELSE 'PERCENTAGE' END
)::"DiscountType";
ALTER TABLE "PromoCode" ALTER COLUMN "discountType" SET DEFAULT 'PERCENTAGE';
ALTER TABLE "PromoCode" ALTER COLUMN "discountValue" TYPE INTEGER USING (
  CASE WHEN "discountType" = 'FIXED' THEN ROUND("discountValue" * 100) ELSE ROUND("discountValue") END
)::INTEGER;
ALTER TABLE "PromoCode" ALTER COLUMN "minPurchaseAmount" TYPE INTEGER USING ROUND("minPurchaseAmount" * 100)::INTEGER;
ALTER TABLE "PromoCodeUsage" ALTER COLUMN "discountAmount" TYPE INTEGER USING ROUND("discountAmount" * 100)::INTEGER;

-- Payment
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerRef" TEXT,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "Payment"("providerRef");
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- IssuedTicket
CREATE TABLE "IssuedTicket" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "IssuedTicketStatus" NOT NULL DEFAULT 'VALID',
  "orderId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "checkedInAt" TIMESTAMP(3),
  "checkedInBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssuedTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IssuedTicket_code_key" ON "IssuedTicket"("code");
CREATE INDEX "IssuedTicket_orderId_idx" ON "IssuedTicket"("orderId");
CREATE INDEX "IssuedTicket_eventId_idx" ON "IssuedTicket"("eventId");
CREATE INDEX "IssuedTicket_ownerId_idx" ON "IssuedTicket"("ownerId");
ALTER TABLE "IssuedTicket" ADD CONSTRAINT "IssuedTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssuedTicket" ADD CONSTRAINT "IssuedTicket_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IssuedTicket" ADD CONSTRAINT "IssuedTicket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- WebhookEvent (idempotency ledger)
CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
