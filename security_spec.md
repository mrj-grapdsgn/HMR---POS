# KasirPOS Multi-Branch Inventory & Analytics Security Specification

## 1. Data Invariants
1. **Strict Tenant Isolation**: Every document across `userProfiles`, `staffAccounts`, `branches`, `products`, `branchStocks`, `stockLogs`, `vouchers`, `transactions`, `transactions/{txId}/items`, and `salesLines` MUST carry `ownerId == request.auth.uid`.
2. **No Negative Stock**: `branchStocks/{stockId}` enforces `currentStock >= 0` and `initialStock >= 0` on both `create` and `update`, guaranteeing zero-stock overselling is impossible even if client UI checks are bypassed.
3. **Relational Referential Integrity (`existsAfter` / `getAfter`)**:
   - Creating a `branchStocks/{stockId}` document MUST reference an existing or atomically created `branches/{branchId}` and `products/{productId}` owned by `request.auth.uid`.
   - Creating a `transactions/{txId}/items/{itemId}` or `salesLines/{lineId}` document MUST reference an existing or atomically created `transactions/{txId}` owned by `request.auth.uid`.
4. **Immutable Financial & Inventory Ledgers**: `transactions`, `transactions/{txId}/items`, `salesLines`, and `stockLogs` forbid `update` and `delete` (`allow update, delete: if false`).
5. **Action-Based Update Isolation**: Every `update` block starts with `isValid[Entity](incoming())`, verifies immutable `ownerId` and `createdAt`, enforces `updatedAt == request.time`, and restricts mutable fields via `affectedKeys().hasOnly(...)`.
6. **Temporal & Volumetric Integrity**: Every `createdAt`/`updatedAt` equals `request.time`; every string enforces `.size()` limits; every ID path variable enforces `isValidId()` (`^[a-zA-Z0-9_-]+$`, `1..128` chars).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Cross-Tenant Stock Read**: User B attempts `get` on User A's `branchStocks/{stockId}` -> `PERMISSION_DENIED`.
2. **Negative Stock Deduction**: User A attempts to update `branchStocks/{stockId}` setting `currentStock: -1` -> `PERMISSION_DENIED`.
3. **Orphan Branch Stock Creation**: User A creates `branchStocks/{stockId}` pointing to a non-existent `branchId` or another user's `productId` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on Branch**: User A updates `branches/{branchId}` with extra field `isVerified: true` -> `PERMISSION_DENIED`.
5. **Immutable SalesLine Tampering**: User A attempts to update `lineTotal` on `salesLines/{lineId}` -> `PERMISSION_DENIED`.
6. **Immutable StockLog Deletion**: User A attempts to delete `stockLogs/{logId}` to hide inventory adjustments -> `PERMISSION_DENIED`.
7. **Orphan SalesLine Injection**: User A creates `salesLines/{lineId}` with a fake `transactionId` that does not exist -> `PERMISSION_DENIED`.
8. **Product Category Oversized String**: User A creates `products/{id}` with a 200-char `category` string -> `PERMISSION_DENIED`.
9. **ID Poisoning**: User A writes to `branches/../../malicious$id` -> `PERMISSION_DENIED`.
10. **Client Timestamp Forgery**: User A creates `transactions/{txId}` with a backdated client timestamp instead of `request.time` -> `PERMISSION_DENIED`.
11. **Invalid Month Injection**: User A creates `transactions/{txId}` with `saleMonth: 13` -> `PERMISSION_DENIED`.
12. **Blanket List Scraping**: Unauthenticated or cross-tenant `list` query without `where('ownerId', '==', uid)` -> `PERMISSION_DENIED`.
