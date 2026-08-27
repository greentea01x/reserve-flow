# Changelog

All notable changes to ReserveFlow are recorded here. This changelog starts on
2026-08-25; earlier repository history remains available in Git.

The format is based on Keep a Changelog. Changes stay under `[Unreleased]` until
the repository owner explicitly creates a release.

## [Unreleased]

### Added

- Added mandatory repository-wide AI session disclosure instructions and a
  structured AI usage log.
- Added a protected demo dataset with 80 employees, one administrator, and three
  meeting rooms, each configured for 20 people with one microphone and one
  projector.
- Added bundled Stitch design references and room imagery for the employee
  booking experience.
- Added a shared Thai Buddhist Era date picker for room search, room booking,
  and rescheduling while keeping Gregorian API and URL values.
- Added booking-owner labels to authorized calendar views while retaining
  private-meeting masking.
- Added a guarded local-development tool that moves an owned future booking
  into the live check-in window and opens the real room QR flow for demos.
- Added a guarded, one-shot database initializer and persisted job titles for
  the canonical three-room, 80-employee, one-administrator dataset.
- Added an administrator-only sidebar mode switch between the employee and
  admin applications while retaining the authenticated session.

### Changed

- Updated employee sign-in to use employee ID and password while retaining email
  as internal account/contact data.
- Refreshed the employee login, navigation, room selection, booking, booking
  history, and QR check-in experience to follow the approved Stitch handoff.
- Updated all three room descriptions to Thai and labelled their booking mode as
  `Auto-approve`.
- Made elapsed calendar slots visually darker and kept lead-time/max-advance
  restrictions distinct from elapsed time.
- Reframed employee-facing auto-release records as `ไม่ได้เช็กอิน` and removed
  the operational status from employee quick filters.
- Added check-in timing guidance and live eligibility refreshes to My Bookings
  so the action appears without requiring a manual page reload.
- Changed the employee-facing `CONFIRMED` label from `ยืนยันแล้ว` to the more
  direct `จองแล้ว`, while retaining domain and administrator terminology.
- Standardized initialized account codes on `AU-001` for the administrator and
  `AU-002`–`AU-081` for employees, with stable mixed departments and job titles.
- Temporarily hid employee-facing email addresses, attendee-email controls and
  counts, and email-delivery copy while retaining internal email data and the
  backend and administrator capabilities.
- Reinitialized the local development database from the canonical dataset after
  demo data pollution and retained recoverable database-level backups of the
  previous data.
- Standardized all 81 local demo credentials on one presenter-only password and
  cleared failed-login locks without weakening the normal password policy.

### Fixed

- Removed the duplicated textual plus sign from the new-booking CTA while
  retaining its plus icon.
- Made “แก้ไขเวลา” return to the selected room's time picker with the previously
  selected date and time range preserved.
- Stabilized asynchronous reschedule prefill and labelled the cancellation
  dialog for assistive technology.
- Corrected the database initialization command in the runbooks and documented
  a post-initialization verification path that does not write demo data.
