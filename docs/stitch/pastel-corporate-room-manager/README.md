# Pastel Corporate Room Manager — Stitch handoff

Downloaded from Stitch project `1451089258791914825` on 2026-08-25. The HTML files are the
original generated screen code; the image files are the hosted screen previews fetched with
`curl -L`. Embedded photography referenced by the HTML is stored under `assets/` so the handoff
does not depend on expiring hosted URLs.

| Screen | Stitch ID | Device | Screenshot | Code |
|---|---|---:|---|---|
| Employee Login | `94bc81e39c9945f3b40ae0831695f57a` | Desktop, 2560×2048 | [PNG](employee-login.png) | [HTML](employee-login.html) |
| Room Selection | `dec61fd5b9b1473ca257bebe47882c89` | Desktop, 2560×1458 | [JPEG](room-selection.jpg) | [HTML](room-selection.html) |
| Room Booking — Weekdays Only | `08527ea62afa4a1e9979e0b2f8f6aae9` | Desktop, 2560×2560 | [JPEG](room-booking-weekdays.jpg) | [HTML](room-booking-weekdays.html) |
| ยืนยันการจอง | `aaade1fda15d4d88b17706999d1a0bcf` | Desktop, 2552×1938 | [JPEG](booking-confirmation.jpg) | [HTML](booking-confirmation.html) |
| My Bookings | `ed28579da5e74957844faba3d95925bd` | Desktop, 2560×1160 | [JPEG](my-bookings.jpg) | [HTML](my-bookings.html) |
| QR Check-in | `1e4d31a1562941b49c17f8a5705dd847` | Mobile, 780×1768 | [PNG](qr-check-in.png) | [HTML](qr-check-in.html) |

## Implementation decisions

The generated HTML is a visual reference, not application code. ReserveFlow keeps its approved
Thai copy, self-hosted Noto Sans Thai font, Tailwind v4 setup, authentication contract, booking
rules, accessibility behavior, and printed-room-QR check-in flow described in
[`../../UI-HANDOFF.md`](../../UI-HANDOFF.md).

The demo data uses three rooms—Horizon, Summit, and Grove. Each holds 20 people and has one
projector plus one microphone. The demo account set contains 80 employees and one admin.
