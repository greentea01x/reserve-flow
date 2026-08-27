import ical, {
  ICalAttendeeRole,
  ICalAttendeeStatus,
  ICalAttendeeType,
  ICalCalendarMethod,
  ICalEventStatus,
} from 'ical-generator';

export type CalendarParty = {
  name: string;
  email: string;
};

export type CalendarMethod = 'REQUEST' | 'CANCEL';

export type CalendarInvite = {
  /** bookings.id — the stable half of the UID. */
  bookingId: string;
  /** bookings.version — emitted verbatim as SEQUENCE, so every transition supersedes the last. */
  version: number;
  summary: string;
  description: string;
  location: string;
  /** Absolute instants. Bangkok wall time must already be resolved by the caller. */
  startAt: Date;
  endAt: Date;
  /** The booking owner. Owner is ORGANIZER, which is why the owner also needs CANCEL. */
  organizer: CalendarParty;
  attendees: readonly CalendarParty[];
  /** Address the mail is actually sent from; becomes ORGANIZER;SENT-BY. */
  sentBy: string;
  url: string;
};

// ponytail: no `timezone` and no `floating` anywhere on purpose. ical-generator then renders
// DTSTART/DTEND/DTSTAMP as UTC "Z" (R-35/V-06: a bare `+07:00` offset is not a legal RFC 5545
// DATE-TIME). The client converts back to Asia/Bangkok itself, so no VTIMEZONE and no TZID
// parameter are needed — which also removes the whole class of "stale TZ database" bugs.
export function buildCalendarInvite(
  invite: CalendarInvite,
  method: CalendarMethod,
  mailDomain: string,
): string {
  const cancelled = method === 'CANCEL';

  const calendar = ical({
    prodId: { company: 'ReserveFlow', product: 'reserveflow', language: 'TH' },
    method: cancelled ? ICalCalendarMethod.CANCEL : ICalCalendarMethod.REQUEST,
    events: [
      {
        // UID = <booking id>@<domain>: stable across REQUEST and CANCEL (spec 03 §3.7).
        id: `${invite.bookingId}@${mailDomain}`,
        sequence: invite.version,
        start: invite.startAt,
        end: invite.endAt,
        summary: invite.summary,
        description: invite.description,
        location: invite.location,
        url: invite.url,
        status: cancelled ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
        organizer: {
          name: invite.organizer.name,
          email: invite.organizer.email,
          sentBy: invite.sentBy,
        },
        attendees: invite.attendees.map((attendee) => ({
          email: attendee.email,
          name: attendee.name,
          role: ICalAttendeeRole.REQ,
          type: ICalAttendeeType.INDIVIDUAL,
          // A CANCEL carries no RSVP request; PARTSTAT is meaningless once the event is gone.
          ...(cancelled ? {} : { rsvp: true, status: ICalAttendeeStatus.NEEDSACTION }),
        })),
      },
    ],
  }).toString();

  // ical-generator 11.1.0 leaves `END:VCALENDAR` unterminated; RFC 5545 §3.1 says every content
  // line ends with CRLF. Cheaper to append it than to argue with a strict parser later.
  return calendar.endsWith('\r\n') ? calendar : `${calendar}\r\n`;
}
