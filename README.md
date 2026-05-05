# WhisperBox

End-to-end encrypted messaging built on the WhisperBox API
(`https://whisperbox.koyeb.app`).

All cryptography happens in the browser
using the Web Crypto API. The server stores and forwards only ciphertext.

---

## Architecture

```
┌──────────────────────────┐                  ┌─────────────────────────┐
│         Browser          │                  │     WhisperBox API      │
│  (React + Web Crypto)    │                  │  (FastAPI + Postgres)   │
│                          │   HTTPS / WSS    │                         │
│  ┌────────────────────┐  │                  │  ┌───────────────────┐  │
│  │ Auth + Key Mgmt    │◄─┼──────────────────┼─►│ /auth/*           │  │
│  │  - PBKDF2 → AES-KW │  │   register/login │  │   stores:         │  │
│  │  - RSA-OAEP keypair│  │   wrapped key +  │  │   public_key,     │  │
│  │  - private key in  │  │   pbkdf2_salt    │  │   wrapped_priv,   │  │
│  │    memory only     │  │                  │  │   pbkdf2_salt     │  │
│  └────────┬───────────┘  │                  │  └───────────────────┘  │
│           │              │                  │                         │
│  ┌────────▼───────────┐  │   ciphertext     │  ┌───────────────────┐  │
│  │ Message Encryption │◄─┼──────────────────┼─►│ /messages /ws     │  │
│  │  - random AES-GCM  │  │   (opaque blobs) │  │   stores opaque   │  │
│  │  - wraps AES key   │  │                  │  │   payload JSON    │  │
│  │    with RSA-OAEP   │  │                  │  └───────────────────┘  │
│  │    (recipient+self)│  │                  │                         │
│  └────────────────────┘  │                  │   never decrypts        │
└──────────────────────────┘                  └─────────────────────────┘
```

---

## Encryption flow

Hybrid encryption per message:

1. Generate a fresh **AES-GCM 256** key and a 96-bit IV (random per message).
2. Encrypt the plaintext with `(AES-GCM key, IV)` → `ciphertext`.
3. Encrypt the AES key with the **recipient's RSA-OAEP public key** →
   `encryptedKey`.
4. Encrypt the same AES key with **your own RSA-OAEP public key** →
   `encryptedKeyForSelf`, so you can read your own outgoing messages later
   on a fresh device.
5. Send `{ ciphertext, iv, encryptedKey, encryptedKeyForSelf }` as the
   message payload (via WebSocket, or REST as fallback).

Decryption:

1. RSA-OAEP-decrypt the appropriate `encryptedKey` (or `encryptedKeyForSelf`
   for own messages) with your private key → AES key.
2. AES-GCM-decrypt the ciphertext with `(AES key, IV)`.
3. AES-GCM authentication tag fails closed; corrupted/tampered messages are
   shown as **"Could not decrypt"** in the UI.

All implementation lives in [`src/lib/crypto.ts`](src/lib/crypto.ts).

---

## Key management

### Registration

1. Browser generates an **RSA-OAEP 2048** keypair.
2. Browser generates a 128-bit random **PBKDF2 salt**.
3. Wrapping key derived: `PBKDF2-SHA256(password, salt, 250 000 iterations)`
   → AES-KW 256.
4. Private key wrapped with AES-KW (`pkcs8` format) → `wrapped_private_key`.
5. POST `{ public_key, wrapped_private_key, pbkdf2_salt, password }` to
   `/auth/register`. The server stores the public key, the wrapped blob,
   and the salt verbatim, and bcrypt-hashes the password for login auth.

### Login / unlock

1. POST username + password to `/auth/login`. Server returns tokens plus
   `wrapped_private_key` + `pbkdf2_salt`.
2. Browser re-derives the wrapping key from the password and unwraps the
   private key into a **non-extractable** `CryptoKey` held in memory only
   ([`src/lib/session.ts`](src/lib/session.ts)).
3. The unwrapped key is never written to storage.
   On reload the user must re-enter their password to unlock.

### Where things live

| Material                 | Location                          | Persistence               |
| ------------------------ | --------------------------------- | ------------------------- |
| Public key (own + peers) | Server + in-memory                | Persistent on server      |
| Wrapped private key      | Server                            | Persistent on server      |
| PBKDF2 salt              | Server                            | Persistent on server      |
| Unwrapped private key    | `CryptoKey` (non-extractable) RAM | Cleared on reload/log out |
| Access token             | Memory only                       | Cleared on reload         |
| Refresh token            | `sessionStorage`                  | Cleared on tab close      |
| Plaintext messages       | RAM only (after decryption)       | Never persisted           |

We deliberately **do not** use `localStorage` for any sensitive material.
We do not store the unwrapped private key in IndexedDB either; this trades
some UX (must unlock per session) for a stronger security posture against
malicious browser extensions and XSS.

---

## Security properties

- ✅ Server cannot read message content — payload is opaque ciphertext.
- ✅ Private key never leaves the client unwrapped.
- ✅ `crypto.subtle.unwrapKey` produces a **non-extractable** key — even
  XSS cannot export the raw private key bytes.
- ✅ AES-GCM authentication catches any tampering with ciphertext or IV.
- ✅ Each message uses a fresh AES key + fresh IV (no key/IV reuse).
- ✅ Refresh tokens scoped to the tab session (`sessionStorage`).
- ✅ HTTPS/WSS-only transport.
- ✅ Input validation with explicit min/max lengths matching the API spec.

## Trade-offs and known limitations

- **No forward secrecy.** Long-term RSA-OAEP keys decrypt every message
  ever sent to the user. Compromising the password (and the wrapped key
  blob) would let an attacker decrypt all historical messages. A real
  production app would layer Signal-style **X3DH + Double Ratchet** on top.
- **Server can perform identity attacks.** The server delivers public keys
  via `/users/{id}/public-key`. A malicious server could substitute a key
  it controls (KCI / MITM). Out-of-band fingerprint verification — shown
  in the chat header (first 32 bits of `SHA-256(public_key)`) — is the
  user's defense.
- **Trust on first use.** We do not pin or persist peer fingerprints
  across sessions, so silent key rotation by the server would not be
  flagged. (A natural enhancement: cache fingerprints in IndexedDB and
  warn on mismatch.)
- **No replay-attack protection beyond AES-GCM uniqueness** (the server is
  trusted not to re-deliver). Messages have stable IDs and the UI
  de-duplicates by ID, but a malicious server could theoretically replay
  arbitrary historical ciphertexts; the client would render them as new
  arrivals.
- **Password is the single point of failure.** If the user forgets their
  password, the wrapped private key cannot be recovered — there is no
  recovery flow by design.
- **Metadata is not protected.** The server sees who messages whom and
  when (timestamps, conversation graph, message sizes). Only content is
  encrypted.
- **Session must be unlocked per browser tab session** (no persistent
  unlocked key). This is a deliberate UX/security trade-off.

---

## Tech stack

- React 18 + Vite + TypeScript
- Tailwind CSS + shadcn/ui (iMessage-style glass theme, light + dark via
  `prefers-color-scheme`)
- Web Crypto API (no third-party crypto libraries)
- WhisperBox REST + WebSocket backend

## Source map

| Path                                      | Purpose                                        |
| ----------------------------------------- | ---------------------------------------------- |
| `src/lib/crypto.ts`                       | All Web Crypto operations                      |
| `src/lib/api.ts`                          | REST client + token refresh                    |
| `src/lib/ws.ts`                           | WebSocket client with auto-reconnect           |
| `src/lib/session.ts`                      | In-memory holder for the unwrapped private key |
| `src/contexts/AuthContext.tsx`            | Auth + key lifecycle                           |
| `src/components/AuthCard.tsx`             | Login / register / unlock                      |
| `src/components/ConversationsSidebar.tsx` | Conversations list + user search               |
| `src/components/ChatThread.tsx`           | Message thread, decryption, send composer      |
| `src/pages/Index.tsx`                     | App shell (sidebar + thread)                   |

---

## License

Built for the HNGi14 internship Task.

## Author

Racheal I. Ogunmodede (TechNurse)

---
