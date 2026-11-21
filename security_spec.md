# KasirPOS Firestore Security Specification (Email/Password Auth + Admin Dashboard)

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document in `/userProfiles`, `/staffAccounts`, `/products`, `/vouchers`, `/transactions`, and `/transactions/{transactionId}/items` MUST belong strictly to `request.auth.uid` (`ownerId == request.auth.uid`). No blanket reads (`allow list: if isSignedIn()`) exist anywhere.
2. **No Email Claim Trust**: Rules never rely on `request.auth.token.email` for authorization, eliminating email-spoofing attacks while allowing newly registered Email/Password users to operate their own isolated store immediately.
3. **Master Gate & Atomicity**: A `TransactionItem` in `/transactions/{transactionId}/items/{itemId}` cannot be created without its parent `/transactions/{transactionId}` existing in the same atomic batch (`existsAfter` + `getAfter`) and belonging to `request.auth.uid`.
4. **Financial Ledger Immutability**: Once created, `/transactions/{transactionId}` and `/transactions/{transactionId}/items/{itemId}` are strictly immutable (`allow update, delete: if false`).
5. **No Shadow Fields & Bounded Sizes**: Every create/update enforces `hasAll` + `hasOnly` and explicit `.size()` limits on every string and ID.
6. **Temporal Integrity**: `createdAt` on create and `updatedAt` on update MUST equal `request.time`.
7. **Zero PII Storage**: Email/password credentials remain isolated in Firebase Auth; Firestore documents store display names and store metadata only, strictly scoped to the owner.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Access**: `request.auth == null` reading `/products/prod-1`.
2. **Cross-Tenant Profile Read**: Reading `/userProfiles/victim-uid` while signed in as `attacker-uid`.
3. **Identity Spoofing on Create**: Creating `/staffAccounts/stf-1` with `ownerId: "victim-uid"`.
4. **Cross-Tenant List Scraping**: Listing `/transactions` or `/staffAccounts` without `ownerId == request.auth.uid`.
5. **Shadow Ghost Field Injection**: Creating `/vouchers/v1` with extra key `superAdmin: true`.
6. **Path ID Poisoning**: Creating `/products/bad$id!@#` with invalid characters or >128 chars.
7. **Denial-of-Wallet String Bomb**: Creating `/staffAccounts/stf-2` with a 500-char `displayName`.
8. **Client-Spoofed Timestamp**: Creating `/transactions/tx-1` with a backdated `createdAt` instead of `request.time`.
9. **Immutable Ledger Tampering**: Updating `grandTotal` or deleting `/transactions/tx-1`.
10. **Orphaned Transaction Item**: Creating `/transactions/non-existent/items/item-1` without an atomic parent transaction.
11. **Owner Reassignment on Update**: Updating `/staffAccounts/stf-1` to change `ownerId` or `createdAt`.
12. **Value Poisoning on Update**: Updating `/vouchers/v1` with `type: 'percent'` and `value: 500` or invalid `role: 'superadmin'` on `/staffAccounts/stf-1`.
