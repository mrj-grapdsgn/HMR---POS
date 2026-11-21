# KasirPOS Firestore Security Specification

## 1. Data Invariants
1. **Strict Ownership**: Every document in `/products`, `/vouchers`, `/transactions`, and `/transactions/{transactionId}/items` MUST have `ownerId == request.auth.uid` and require `request.auth.token.email_verified == true`.
2. **Master Gate & Atomicity**: A `TransactionItem` in `/transactions/{transactionId}/items/{itemId}` cannot be created without its parent `/transactions/{transactionId}` existing in the same atomic batch (`existsAfter` + `getAfter`) and belonging to `request.auth.uid`.
3. **Financial Ledger Immutability**: Once created, `/transactions/{transactionId}` and `/transactions/{transactionId}/items/{itemId}` are strictly immutable (`allow update, delete: if false`).
4. **No Shadow Fields & Bounded Sizes**: Every create/update enforces `hasAll` + `hasOnly` and explicit `.size()` limits on every string and ID.
5. **Temporal Integrity**: `createdAt` on create and `updatedAt` on update MUST equal `request.time` (server timestamps).
6. **Zero PII Exposure**: No emails, phone numbers, or personal addresses are stored in Firestore.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Product Read/Write**: `request.auth == null` reading `/products/prod-1`.
2. **Unverified Email Write**: `request.auth.token.email_verified == false` creating a product.
3. **Identity Spoofing**: Creating `/products/prod-1` with `ownerId: "victim-uid"` while signed in as `"attacker-uid"`.
4. **Cross-Tenant List Scraping**: Listing `/transactions` without filtering `ownerId == request.auth.uid`.
5. **Shadow / Ghost Field Injection**: Creating `/products/prod-1` with an extra key `isAdmin: true`.
6. **Path ID Poisoning**: Creating `/products/../../evil$id` with invalid characters or >128 chars.
7. **Denial-of-Wallet String Bomb**: Creating `/products/prod-1` with a 50KB `name` string.
8. **Client-Spoofed Timestamp**: Creating `/transactions/tx-1` with a backdated `createdAt` instead of `request.time`.
9. **Immutable Ledger Tampering**: Updating `grandTotal` or deleting `/transactions/tx-1` after checkout.
10. **Orphaned Transaction Item**: Creating `/transactions/non-existent/items/item-1` without an atomic parent transaction.
11. **Owner Reassignment on Update**: Updating `/products/prod-1` to change `ownerId` or `createdAt`.
12. **Value Poisoning on Update**: Updating `/products/prod-1` with negative `price: -5000` or invalid `category: "Hacked"`.
