# Firestore Security Rules Specification

This document details the security specification for the Fitness and Customization App, including Data Invariants, adversarial test payloads (the "Dirty Dozen"), and validation criteria to ensure no security vulnerabilities or shadow updates can occur on the Firestore instance.

## 1. Data Invariants

1. **User Identity Invariant**: Users can only read, create, update, or list documents contained within their own `/users/{userId}` path hierarchy. Identity spoofing is prevented by binding `{userId}` in paths to `request.auth.uid`.
2. **Type and Size Hardening Invariant**: All fields must carry strict types and size/boundary limits. No unlimited string inputs or unrestricted array sizes are accepted.
3. **Numeric Overflow and Type Invariant**: All balances, XP, levels, durations, and rewards must be validated as non-negative `number` values (incorporating both integer increments and base numbers).
4. **Action-Based Update Constraints (Anti-Shadow Updates)**: Any profile or state updates must use strict `affectedKeys().hasOnly()` checks to prevent untyped or malicious fields from being altered alongside standard properties.
5. **Timestamp Integrity Invariant**: All temporal fields must map directly to server-provided transactional timestamps (`request.time`).
6. **Immutable Fields**: Fields establishing the resource context (e.g., identity properties like `userId`) must be immutable once created.

---

## 2. The "Dirty Dozen" (Test Payloads)

Here are the 12 payloads targeting common entry points. Each payload must return `PERMISSION_DENIED` under all circumstances.

### Payload 1: Identity Spoofing (Create Profile as Another User)
* **Underwriter**: Authenticated as User `A`, tries to create profile for User `B`.
* **Path**: `/users/User_B`
* **JSON**:
```json
{
  "userId": "User_B",
  "displayName": "Spoofed Profile",
  "level": 1,
  "currentXp": 0,
  "balanceGold": 100,
  "inventory": ["item-18"],
  "equippedItems": ["item-18"],
  "lastUpdated": "2026-05-13T12:00:00Z"
}
```

### Payload 2: Shadow Field Injection (Ghost Field)
* **Underwriter**: Authenticated as User `A`, tries to inject an unauthorized `isAdmin` field during profile update.
* **Path**: `/users/User_A`
* **JSON (Update)**:
```json
{
  "displayName": "User A",
  "isAdmin": true
}
```

### Payload 3: Character ID Poisoning (Denial of Wallet Range Attack)
* **Underwriter**: Authenticated as User `A`, attempts to set a huge junk-character ID to crash database indices or exhaust storage quotas.
* **Path**: `/users/User_A/workout_logs/log-JUNK_1000_CHARACTERS`
* **JSON**:
```json
{
  "logId": "log-JUNK_1000_CHARACTERS",
  "userId": "User_A",
  "type": "Squats",
  "duration": 60,
  "counts": 10,
  "goldEarned": 5,
  "timestamp": "2026-05-13T12:00:00Z"
}
```

### Payload 4: Arbitrary Multi-Field Write (State Shortcutting)
* **Underwriter**: Authenticated as User `A`, tries to update both avatar image and level / gold balances in a single unchecked update action.
* **Path**: `/users/User_A`
* **JSON (Update)**:
```json
{
  "avatar": "🏋️",
  "balanceGold": 999999
}
```

### Payload 5: Infinite Reward Exploitation (Float Type-clash)
* **Underwriter**: Authenticated as User `A`, attempts to credit infinity gold or extremely large float values.
* **Path**: `/users/User_A`
* **JSON (Update)**:
```json
{
  "balanceGold": 1e20
}
```

### Payload 6: Negative Values in Settings (Boundary Violation)
* **Underwriter**: Authenticated as User `A`, attempts to write a negative sound volume.
* **Path**: `/users/User_A/settings/current`
* **JSON**:
```json
{
  "userId": "User_A",
  "bgmVolume": -0.5,
  "isMuted": false,
  "voiceGuideEnabled": true,
  "warmupEnabled": true
}
```

### Payload 7: Orphaned Sub-Resource Creation
* **Underwriter**: Authenticated as User `A`, attempts to write a workout log belonging to User `B`.
* **Path**: `/users/User_A/workout_logs/log-1234`
* **JSON**:
```json
{
  "logId": "log-1234",
  "userId": "User_B",
  "type": "Squats",
  "duration": 60,
  "counts": 10,
  "goldEarned": 5,
  "timestamp": "2026-05-13T12:00:00Z"
}
```

### Payload 8: Immutable Field Override (User Impersonation)
* **Underwriter**: Authenticated as User `A`, attempts to change their own profile `userId` to lock identity properties or spoof historical traces.
* **Path**: `/users/User_A`
* **JSON (Update)**:
```json
{
  "userId": "User_B"
}
```

### Payload 9: Array Corruption attack (Giant array size payload)
* **Underwriter**: Authenticated as User `A`, attempts to corrupt profile sub-arrays by writing 10,000 blank strings to exhaust collection performance.
* **Path**: `/users/User_A`
* **JSON (Update)**:
```json
{
  "inventory": ["", "", "", "..." /* repeated 10,000 times */]
}
```

### Payload 10: Client-side Timestamp Manipulation
* **Underwriter**: Authenticated as User `A`, attempts to set a custom future timestamp to secure retro-active workout completions.
* **Path**: `/users/User_A/workout_logs/log-123`
* **JSON**:
```json
{
  "logId": "log-123",
  "userId": "User_A",
  "type": "Plank",
  "duration": 30,
  "counts": 1,
  "goldEarned": 2,
  "timestamp": "2029-12-31T23:59:59Z"
}
```

### Payload 11: Global Shop Item Exploitation (Public Defacement)
* **Underwriter**: Authenticated as User `A`, tries to write or overwrite standard global shop listings.
* **Path**: `/shop_items/item-cheat`
* **JSON**:
```json
{
  "itemId": "item-cheat",
  "name": "Super Weapon",
  "category": "outfit",
  "price": 0,
  "modelPath": "/cheat.glb"
}
```

### Payload 12: Blanket Data Scraping / Mining
* **Underwriter**: Authenticated as User `A` (or anonymous), attempts to trigger a list query to harvest details of other user accounts.
* **Path**: `/users`
* **Query**: `getDocs(collection(db, 'users'))` without owner filtering constraint.

---

## 3. Conceptual Test Runner (`firestore.rules.test.ts`)

A clean integration test suite verifying these rules with the rules emulator looks as follows:

```typescript
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { setDoc, getDoc, updateDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "gen-lang-client-0612970062",
    firestore: {
      rules: require('fs').readFileSync('firestore.rules', 'utf8')
    }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

test("Payload 1: Identity Spoofing fails", async () => {
  const aliceContext = testEnv.authenticatedContext("User_A");
  const db = aliceContext.firestore();
  
  const badDocRef = setDoc(doc(db, "users/User_B"), {
    userId: "User_B",
    displayName: "Spoofed Profile",
    level: 1,
    balanceGold: 100
  });
  
  await expect(badDocRef).rejects.toThrow();
});

test("Payload 2: Shadow Field Injection fails", async () => {
  const aliceContext = testEnv.authenticatedContext("User_A");
  const db = aliceContext.firestore();
  
  // Create first
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users/User_A"), {
      userId: "User_A",
      displayName: "User A",
      level: 1,
      balanceGold: 100
    });
  });

  const badUpdate = updateDoc(doc(db, "users/User_A"), {
    isAdmin: true
  });
  
  await expect(badUpdate).rejects.toThrow();
});
```
